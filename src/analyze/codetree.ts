import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import ts from "typescript";

export interface FileMeta {
  imports: string[];
  exports: {
    classes: { name: string; methods: string[] }[];
    functions: string[];
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

  public parseFileMetadata(code: string): FileMeta {
    const imports: string[] = [];
    const classes: { name: string; methods: string[] }[] = [];
    const functions: string[] = [];
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
            const methods: string[] = [];
            node.members.forEach((member) => {
              if (
                ts.isMethodDeclaration(member) &&
                member.name &&
                ts.isIdentifier(member.name)
              ) {
                methods.push(member.name.text);
              }
            });
            classes.push({ name: className, methods });
          } else if (ts.isFunctionDeclaration(node) && node.name) {
            functions.push(node.name.text);
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
                lines.push(`  - ${method}()`);
              }
            }
            for (const fn of functions) {
              lines.push(`- ${fn}()`);
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
