import ts from "typescript";

export class ASTCompressor {
  public static compress(code: string): string {
    try {
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, code);
      let result = "";
      let token = scanner.scan();
      let lastPos = 0;

      while (token !== ts.SyntaxKind.EndOfFileToken) {
        if (
          token === ts.SyntaxKind.SingleLineCommentTrivia ||
          token === ts.SyntaxKind.MultiLineCommentTrivia
        ) {
          result += code.slice(lastPos, scanner.getTokenPos());
          lastPos = scanner.getTextPos();
        }
        token = scanner.scan();
      }
      result += code.slice(lastPos);

      return result
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .join("\n")
        .trim();
    } catch (e: unknown) {
      console.warn("[ASTCompressor] Fallback triggered:", e);
      // String-aware regex to strip comments without touching strings
      // Matches strings (single, double, backtick) or comments.
      // Replaces comments with empty string, keeps strings intact.
      let result = code.replace(/(".*?"|'.*?'|`[^]*?`)|\/\*[\s\S]*?\*\/|\/\/.*$/gm, (match, grp1) => {
        if (grp1) return grp1;
        return "";
      });
      return result
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .join("\n")
        .trim();
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
