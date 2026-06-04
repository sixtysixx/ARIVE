import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import ts from "typescript";

export interface FileMeta {
  imports: string[];
  exports: {
    classes: { name: string; methods: string[] }[];
    functions: string[];
    interfaces: string[];
  };
}

export class CodeMapScanner {
  private defaultExcludes = [
    "node_modules",
    ".git",
    ".arive-worktrees",
    "dist",
    ".arive",
    "package-lock.json",
    "bun.lockb"
  ];

  public scanTree(dir: string, excludes: string[] = []): string {
    const excludeList = [...this.defaultExcludes, ...excludes];
    const lines: string[] = [];
    this.traverse(dir, "", excludeList, lines);
    return lines.join("\n");
  }

  private traverse(currentPath: string, prefix: string, excludes: string[], lines: string[]) {
    const base = path.basename(currentPath);
    // Check if base matches any excluded names or if current path contains them
    if (excludes.includes(base) || excludes.some(exc => currentPath.split(path.sep).includes(exc))) {
      return;
    }

    try {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        lines.push(`${prefix}📁 ${base}/`);
        const children = fs.readdirSync(currentPath);
        children.forEach(child => {
          this.traverse(path.join(currentPath, child), prefix + "  ", excludes, lines);
        });
      } else {
        lines.push(`${prefix}📄 ${base} (${stats.size} bytes)`);
      }
    } catch (e) {}
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
        ts.ScriptKind.TS
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
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const isExported = modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            const methods: string[] = [];
            node.members.forEach(member => {
              if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
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
    } catch (e) {}

    return { imports, exports: { classes, functions, interfaces } };
  }

  public getGitDiff(targetBranch = "master"): string {
    try {
      const diff = execSync(`git diff ${targetBranch} --stat`, { encoding: "utf-8" });
      return diff || "No differences against target branch.";
    } catch (e: any) {
      return `Git diff failed: ${e.message}`;
    }
  }
}
