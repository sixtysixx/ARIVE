export class ContentRouter {
  public static classify(content: string): "json" | "code" | "logs" | "prose" {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch (e) {}
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch (e) {}
    }

    // Simple regex heuristics for TS/JS/Python/Go code
    const codeKeywords = /\b(function|const|let|import|export|class|def|package|func|return)\b/;
    const curlyBlocks = /\{[\s\S]*\}/;
    if (codeKeywords.test(trimmed) && curlyBlocks.test(trimmed)) {
      return "code";
    }

    const logKeywords = /\b(ERROR|WARN|INFO|DEBUG|TRACE|exception|stacktrace|stderr|stdout)\b/i;
    if (logKeywords.test(trimmed) && trimmed.split("\n").length > 3) {
      return "logs";
    }

    return "prose";
  }
}
