import ts from "typescript";

export class ASTCompressor {
  public static compress(code: string): string {
    try {
      const sourceFile = ts.createSourceFile(
        "temp.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
      );
      let result = "";
      const visit = (node: ts.Node) => {
        if (ts.isSourceFile(node)) {
          ts.forEachChild(node, visit);
        } else {
          const text = node.getText(sourceFile);
          result += text + "\n";
        }
      };
      visit(sourceFile);
      return code
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
    } catch (e) {
      return code;
    }
  }

  public static compressMultiLanguage(code: string, language: string): string {
    const lang = language.toLowerCase();
    if (
      lang === "typescript" ||
      lang === "javascript" ||
      lang === "ts" ||
      lang === "js"
    ) {
      return this.compress(code);
    }

    let result = code;
    if (lang === "python") {
      // Strip docstrings
      result = result.replace(/\"\"\"[\s\S]*?\"\"\"/g, "");
      result = result.replace(/\'\'\'[\s\S]*?\'\'\'/g, "");
      // Strip inline comments
      result = result.replace(/#.*$/gm, "");
    } else if (["go", "rust", "cpp", "c", "java"].includes(lang)) {
      // Strip block comments
      result = result.replace(/\/\*[\s\S]*?\*\//g, "");
      // Strip inline comments
      result = result.replace(/\/\/.*$/gm, "");
    }

    // Cleanup whitespace lines
    return result
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }
}
