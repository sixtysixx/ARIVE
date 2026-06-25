export class ContentRouter {
  private static profiles = {
    json: ['":', ', "', "[", "]"],
    code: [
      "function",
      "import",
      "const",
      "return",
      "class",
      "public",
      "fn ",
      "def ",
      "struct",
      "let ",
      "var ",
    ],
    logs: [
      "error",
      "warn",
      "info",
      "fail",
      "success",
      "exception",
      "stack",
      "at ",
      "trace",
      "unhandled",
    ],
    prose: [
      "the",
      "and",
      "was",
      "that",
      "for",
      "this",
      "with",
      "markdown",
      "text",
      "description",
      "document",
    ],
  };

  public static classify(content: string): "json" | "code" | "logs" | "prose" {
    const clean = content.toLowerCase();

    // Word Tokenization
    const words = clean
      .split(/[^a-zA-Z{}":,\[\]#\/]+/)
      .filter((w) => w.length > 0);
    const frequencies: Record<string, number> = {};
    words.forEach((w) => {
      frequencies[w] = (frequencies[w] || 0) + 1;
    });

    let bestType: "json" | "code" | "logs" | "prose" = "prose";
    let maxScore = -1;

    for (const [type, keywords] of Object.entries(this.profiles)) {
      let score = 0;
      keywords.forEach((keyword) => {
        if (clean.includes(keyword)) {
          // Give term weight matching frequencies
          const freq =
            type === "json" && (keyword === "{" || keyword === "}")
              ? 0.1
              : frequencies[keyword.trim()] || 0.5;
          score += freq;
        }
      });

      if (score > maxScore) {
        maxScore = score;
        bestType = type as "json" | "code" | "logs" | "prose";
      }
    }

    // Exact check for typical JSON (high confidence)
    if (
      clean.trim().startsWith("{") &&
      clean.trim().endsWith("}") &&
      !clean.includes("function") &&
      !clean.includes("const")
    ) {
      return "json";
    }

    return bestType;
  }
}
