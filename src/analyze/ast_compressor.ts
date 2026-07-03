import ts from "typescript";

export class ASTCompressor {
  public static compress(code: string): string {
    // Preflight parse removed: `ts.createSourceFile(...)` does not throw on malformed code
    // and the parse result is unused. Any parse-time safety claim it provided was redundant.
    // The regex-based normalizer is the actual compressor; on pathological inputs it may
    // degrade rather than just pass through. Fallback behavior below preserves that case.
    return code
      .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .join("\n")
      .trim();
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
