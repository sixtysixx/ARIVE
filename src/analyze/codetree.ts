import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import ts from "typescript";

export interface FunctionMeta {
  name: string;
  signature: string;
  description: string;
  usage: string;
}

export interface ClassMeta {
  name: string;
  methods: FunctionMeta[];
}

export interface FileMeta {
  imports: string[];
  exports: {
    classes: ClassMeta[];
    functions: FunctionMeta[];
    interfaces: string[];
  };
}

export class CodeTreeScanner {
  private readonly defaultExcludes: string[] = [
    "node_modules",
    ".git",
    ".arive-worktrees",
    "dist",
    ".arive",
    "package-lock.json",
    "bun.lockb",
  ];

  public scanTree(dir: string, excludes: string[] = []): string {
    const excludeList = [...this.defaultExcludes, ...excludes];
    const lines: string[] = [];
    this.traverse(dir, "", excludeList, lines, 0);
    return lines.join("\n");
  }

  private traverse(
    currentPath: string,
    prefix: string,
    excludes: string[],
    lines: string[],
    currentDepth: number,
  ) {
    const base = path.basename(currentPath);
    // Check if base matches any excluded names or if current path contains them as exact segments
    if (
      excludes.includes(base) ||
      excludes.some((exc) => currentPath.split(/[\\/]/).includes(exc))
    ) {
      return;
    }

    try {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        lines.push(`${prefix}📁 ${base}/`);
        const children = fs.readdirSync(currentPath);
        children.forEach((child) => {
          this.traverse(
            path.join(currentPath, child),
            prefix + "  ",
            excludes,
            lines,
            currentDepth + 1,
          );
        });
      } else {
        lines.push(`${prefix}📄 ${base} (${stats.size} bytes)`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`${prefix}⚠️ Error reading ${base}: ${msg}`);
    }
  }

  private getJsDoc(node: ts.Node): string {
    const docs = ts.getJSDocCommentsAndTags(node);
    if (docs && docs.length > 0) {
      return docs
        .map((doc) => {
          if (ts.isJSDoc(doc)) {
            let result =
              typeof doc.comment === "string"
                ? doc.comment
                : doc.comment
                  ? (doc.comment as ts.NodeArray<ts.JSDocText>).map(c => c.text).join("")
                  : "";
            if (doc.tags && Array.isArray(doc.tags)) {
              doc.tags.forEach((tag: ts.JSDocTag) => {
                const tagName = tag.tagName?.text || "";
                const tagComment =
                  typeof tag.comment === "string"
                    ? tag.comment
                    : tag.comment
                      ? (tag.comment as ts.NodeArray<ts.JSDocText>).map(c => c.text).join("")
                      : "";
                result += `\n@${tagName} ${tagComment}`;
              });
            }
            return result.trim();
          } else {
             const tag = doc as ts.JSDocTag;
             const tagName = tag.tagName?.text || "";
             const tagComment =
               typeof tag.comment === "string"
                 ? tag.comment
                 : tag.comment
                   ? (tag.comment as ts.NodeArray<ts.JSDocText>).map(c => c.text).join("")
                   : "";
             return `@${tagName} ${tagComment}`.trim();
          }
        })
        .join("\n\n")
        .trim();
    }
    return "";
  }

  private extractFunctionMeta(
    name: string,
    node: ts.Node,
    sourceFile: ts.SourceFile,
    isArrow = false,
  ): FunctionMeta {
    const printer = ts.createPrinter({ removeComments: true });
    let sigStr = "";
    let docs = "";

    if (isArrow && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      let clone;
      if (ts.isArrowFunction(node)) {
        clone = ts.factory.createArrowFunction(
          node.modifiers,
          node.typeParameters,
          node.parameters,
          node.type,
          node.equalsGreaterThanToken,
          ts.factory.createIdentifier("dummy"), // Use dummy identifier to prevent body printing
        );
      } else {
        clone = ts.factory.createFunctionExpression(
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          ts.factory.createBlock([]),
        );
      }

      sigStr = printer.printNode(ts.EmitHint.Unspecified, clone, sourceFile).trim();
      if (sigStr.endsWith(" dummy")) {
        sigStr = sigStr.slice(0, -6).trim();
      } else if (sigStr.endsWith("dummy")) {
        sigStr = sigStr.slice(0, -5).trim();
      } else if (sigStr.endsWith("{ }")) {
        sigStr = sigStr.slice(0, -3).trim();
      } else if (sigStr.endsWith("{}")) {
        sigStr = sigStr.slice(0, -2).trim();
      }

      // For variables, JSDoc is attached to the VariableStatement
      docs = this.getJsDoc(node.parent.parent.parent);

    } else if (ts.isFunctionDeclaration(node)) {
      const clone = ts.factory.createFunctionDeclaration(
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        undefined,
      );
      sigStr = printer.printNode(ts.EmitHint.Unspecified, clone, sourceFile).trim();
      docs = this.getJsDoc(node);
    } else if (ts.isMethodDeclaration(node)) {
      const clone = ts.factory.createMethodDeclaration(
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.questionToken,
        node.typeParameters,
        node.parameters,
        node.type,
        undefined,
      );
      sigStr = printer.printNode(ts.EmitHint.Unspecified, clone, sourceFile).trim();
      docs = this.getJsDoc(node);
    } else {
      sigStr = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).trim();
      docs = this.getJsDoc(node);
    }

    // Strip 'export ' or 'export default ' prefix if present and remove trailing semicolons
    sigStr = sigStr.replace(/^export\s+(default\s+)?/, "").replace(/;$/, "").trim();

    // Replace multiple spaces and newlines with a single space for concise JSON output
    sigStr = sigStr.replace(/\s+/g, " ");

    return {
      name,
      signature: sigStr,
      description: docs,
      usage: docs ? "Refer to description and signature." : "",
    };
  }

  public parseFileMetadata(code: string): FileMeta {
    const imports: string[] = [];
    const classes: ClassMeta[] = [];
    const functions: FunctionMeta[] = [];
    const interfaces: string[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        "temp.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const visit = (node: ts.Node) => {
        // Find Imports
        if (ts.isImportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (ts.isStringLiteral(specifier)) {
            imports.push(specifier.text);
          }
        }

        // Find Exported Items
        const modifiers = ts.canHaveModifiers(node)
          ? ts.getModifiers(node)
          : undefined;
        const isExported = modifiers?.some(
          (m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword,
        );
        if (isExported) {
          if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            const methods: FunctionMeta[] = [];
            node.members.forEach((member) => {
              if (
                ts.isMethodDeclaration(member) &&
                member.name &&
                ts.isIdentifier(member.name)
              ) {
                const methodModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
                const isPrivateOrProtected = methodModifiers?.some(
                  (m) =>
                    m.kind === ts.SyntaxKind.PrivateKeyword ||
                    m.kind === ts.SyntaxKind.ProtectedKeyword
                );

                if (!isPrivateOrProtected) {
                  methods.push(
                    this.extractFunctionMeta(member.name.text, member, sourceFile),
                  );
                }
              }
            });
            classes.push({ name: className, methods });
          } else if (ts.isFunctionDeclaration(node) && node.name) {
            functions.push(
              this.extractFunctionMeta(node.name.text, node, sourceFile),
            );
          } else if (ts.isVariableStatement(node)) {
            const decls = node.declarationList.declarations;
            for (const decl of decls) {
              if (
                ts.isVariableDeclaration(decl) &&
                decl.name &&
                ts.isIdentifier(decl.name) &&
                decl.initializer &&
                (ts.isArrowFunction(decl.initializer) ||
                  ts.isFunctionExpression(decl.initializer))
              ) {
                functions.push(
                  this.extractFunctionMeta(
                    decl.name.text,
                    decl.initializer,
                    sourceFile,
                    true,
                  ),
                );
              }
            }
          } else if (ts.isInterfaceDeclaration(node) && node.name) {
            interfaces.push(node.name.text);
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: unknown) {
      console.warn("TypeScript metadata parsing error:", e);
    }

    return { imports, exports: { classes, functions, interfaces } };
  }

  public getGitDiff(targetBranch = "master"): string {
    // Sanitize target branch name to prevent command injection / unexpected arguments
    // Require first char to be alphanumeric — blocks leading `-` (e.g. --no-index) argument injection.
    const safeBranchPattern = /^[a-zA-Z0-9][a-zA-Z0-9_\-\/\.\+]*$/;
    if (!safeBranchPattern.test(targetBranch)) {
      return "Git diff failed: Invalid branch name (must start with alphanumeric).";
    }

    try {
      const diff = execFileSync("git", ["diff", targetBranch, "--stat"], {
        encoding: "utf-8",
      });
      return diff || "No differences against target branch.";
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return `Git diff failed: ${errorMessage}`;
    }
  }

  public scanCodemap(
    dir: string,
    excludes: string[] = [],
  ): { codemap: Record<string, FileMeta>; needsComments: { file: string; name: string }[] } {
    const excludeList = [...this.defaultExcludes, ...excludes];
    const codemap: Record<string, FileMeta> = {};
    const needsComments: { file: string; name: string }[] = [];

    this.collectDependencies(dir, excludeList, codemap);

    for (const [file, meta] of Object.entries(codemap)) {
      for (const fn of meta.exports.functions) {
        if (!fn.description) {
          needsComments.push({ file, name: fn.name });
        }
      }
      for (const cls of meta.exports.classes) {
        for (const method of cls.methods) {
          if (!method.description) {
            needsComments.push({ file, name: `${cls.name}.${method.name}` });
          }
        }
      }
    }

    const outputDir = path.join(dir, ".arive");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outputDir, "codemap.json"), JSON.stringify(codemap, null, 2), "utf-8");

    return { codemap, needsComments };
  }

  public scanDependencies(
    dir: string,
    excludes: string[] = [],
  ): Record<string, FileMeta> {
    const excludeList = [...this.defaultExcludes, ...excludes];
    const result: Record<string, FileMeta> = {};
    this.collectDependencies(dir, excludeList, result);
    return result;
  }

  private collectDependencies(
    currentPath: string,
    excludes: string[],
    result: Record<string, FileMeta>,
  ) {
    const base = path.basename(currentPath);
    if (
      excludes.includes(base) ||
      excludes.some((exc) => currentPath.split(/[\\/]/).includes(exc))
    ) {
      return;
    }

    try {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        const children = fs.readdirSync(currentPath);
        children.forEach((child) => {
          this.collectDependencies(
            path.join(currentPath, child),
            excludes,
            result,
          );
        });
      } else if (stats.isFile() && /\.(js|ts|jsx|tsx)$/.test(currentPath)) {
        const code = fs.readFileSync(currentPath, "utf-8");
        const relative = path.relative(".", currentPath).replace(/\\/g, "/");
        result[relative] = this.parseFileMetadata(code);
      }
    } catch (e) {}
  }

  public writeCodeIndex(
    dir: string,
    excludes: string[] = [],
    outputPath: string,
  ): void {
    const excludeList = [...this.defaultExcludes, ...excludes];
    const files: string[] = [];
    this.collectIndexFiles(dir, excludeList, files);

    const lines: string[] = [`# Code Index: ${dir}`, ``];

    for (const file of files) {
      const relative = path.relative(dir, file).replace(/\\/g, "/");
      try {
        const code = fs.readFileSync(file, "utf-8");
        const meta = this.parseFileMetadata(code);

        if (meta.imports.length > 0) {
          lines.push(`<details>`);
          lines.push(`<summary>📄 <code>${relative}</code></summary>`);
          lines.push(``);
          lines.push(`Imports: ${meta.imports.join(", ")}`);

          const classes = meta.exports.classes;
          const functions = meta.exports.functions;
          const interfaces = meta.exports.interfaces;
          const total = classes.length + functions.length + interfaces.length;

          if (total > 0) {
            lines.push(``);
            lines.push(`**Exports:**`);
            for (const cls of classes) {
              lines.push(`- class ${cls.name}`);
              for (const method of cls.methods) {
                lines.push(`  - ${method.name}()`);
              }
            }
            for (const fn of functions) {
              lines.push(`- ${fn.name}()`);
            }
            for (const iface of interfaces) {
              lines.push(`- interface ${iface}`);
            }
          }

          lines.push(`</details>`);
          lines.push(``);
        }
      } catch {
        // Ignore unreadable files
      }
    }

    try {
      const dirPath = path.dirname(outputPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
      console.log(`✓ Wrote code index → ${outputPath}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`! Failed to write code index: ${msg}`);
    }
  }

  private collectIndexFiles(
    currentPath: string,
    excludes: string[],
    files: string[],
  ): void {
    const base = path.basename(currentPath);
    if (
      excludes.includes(base) ||
      excludes.some((exc) => currentPath.split(/[\\/]/).includes(exc))
    ) {
      return;
    }

    try {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        const children = fs.readdirSync(currentPath);
        for (const child of children) {
          this.collectIndexFiles(
            path.join(currentPath, child),
            excludes,
            files,
          );
        }
      } else if (stats.isFile() && /\.(js|ts|jsx|tsx)$/.test(currentPath)) {
        files.push(currentPath);
      }
    } catch {
      // Ignore
    }
  }
}
