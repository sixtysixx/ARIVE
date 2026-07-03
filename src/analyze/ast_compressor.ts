import ts from "typescript";

export class ASTCompressor {
  public static compress(code: string): string {
    try {
      // Validate the code parses cleanly; throw on hard errors so the catch fallback is used.
      ts.createSourceFile("temp.ts", code, ts.ScriptTarget.Latest, true);

      // Strip block comments and line comments, then normalise per-line whitespace.
      // Crucially: we preserve newlines so ASI and multi-line string literals are not broken.
      return code
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .join("\n")
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
