export class ContentRouter {
  private static profiles: Record<string, Set<string>> = {
    json: new Set(['":', ', "', "[", "]"]),
    code: new Set([
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
    ]),
    logs: new Set([
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
    ]),
    prose: new Set([
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
    ]),
  };

  public static classify(content: string): "json" | "code" | "logs" | "prose" {
    const clean = content.toLowerCase();
    const sampleLen = Math.min(clean.length, 2048);
    const sample = clean.slice(0, sampleLen);

    // Quick JSON check on sample
    if (
      sample.trim().startsWith("{") &&
      sample.trim().endsWith("}") &&
      !sample.includes("function") &&
      !sample.includes("const")
    ) {
      return "json";
    }

    let bestType: "json" | "code" | "logs" | "prose" = "prose";
    let maxScore = -1;

    for (const [type, keywords] of Object.entries(this.profiles)) {
      let score = 0;
      for (const keyword of keywords) {
        if (sample.includes(keyword)) {
          // Use simple presence scoring for sample
          score += 1;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestType = type as "json" | "code" | "logs" | "prose";
      }
    }

    return bestType;
  }
}
