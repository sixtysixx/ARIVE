export class LithicFormatter {
  public static format(message: string, brevity: "lite" | "full" | "ultra" | "normal" = "full"): string {
    if (brevity === "normal") {
      return message;
    }

    let txt = message;

    // 1. Lite: Filter conversational padding & hedging
    const conversationalPadding = [
      /\bplease\b/gi,
      /\bliterally\b/gi,
      /\bjust\b/gi,
      /\bactually\b/gi,
      /\bbasically\b/gi,
      /\bsimply\b/gi,
      /\bkind of\b/gi,
      /\bsort of\b/gi,
      /\bhonestly\b/gi
    ];

    for (const pattern of conversationalPadding) {
      txt = txt.replace(pattern, "");
    }

    if (brevity === "lite") {
      const result = txt.replace(/\s+/g, " ").trim();
      if (result.length > 0) {
        return result.charAt(0).toUpperCase() + result.slice(1);
      }
      return result;
    }

    // 2. Full: Remove articles, basic helper/auxiliary verbs
    if (brevity === "full" || brevity === "ultra") {
      const fullFilters = [
        /\b(the|a|an)\b/gi,
        /\b(is|are|was|were|been)\b/gi,
        /\b(have|has|had)\b/gi,
        /\b(do|does|did)\b/gi,
        /\b(successfully|extremely|highly|properly)\b/gi
      ];

      for (const pattern of fullFilters) {
        txt = txt.replace(pattern, "");
      }
    }

    // 3. Ultra: Map aggressively to keyword fragments
    if (brevity === "ultra") {
      // Replace common wordings with direct tags
      txt = txt
        .replace(/\b(?:at|inside)?\s*file\s+(\S+)/gi, "$1")
        .replace(/\b(?:at\s+)?line number\s+(\d+)\b/gi, ":$1")
        .replace(/\b(?:at\s+)?line\s+(\d+)\b/gi, ":$1")
        .replace(/\bsuite\b/gi, "")
        .replace(/\bfailed\b/gi, "fail")
        .replace(/\bpassed\b/gi, "pass")
        .replace(/\bcompleted\b/gi, "done");
    }

    // Clean up redundant double spaces and spaces around punctuations
    const result = txt
      .replace(/\s+/g, " ")
      .replace(/\s+([.,:;!])/g, "$1")
      .trim();

    if (result.length > 0) {
      return result.charAt(0).toUpperCase() + result.slice(1);
    }
    return result;
  }

  public static getSavings(original: string, formatted: string): string {
    const origTokens = original.split(/\s+/).length;
    const formTokens = formatted.split(/\s+/).length;
    const reduction = origTokens > 0 ? Math.round(((origTokens - formTokens) / origTokens) * 100) : 0;
    return `${reduction}% token reduction (${origTokens} -> ${formTokens} tokens)`;
  }
}
