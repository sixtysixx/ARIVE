export async function handleCompress(
  args: Record<string, unknown>,
  deps: {
    getCCR: () => { store: (content: string, type: string) => string };
    getCompactHelpers: () => {
      compactText: (
        text: string,
        phase: string,
        meta: Record<string, unknown>,
        threshold?: number,
      ) => string;
    };
    ContentRouter: {
      classify: (content: string) => "json" | "code" | "logs" | "prose";
    };
    SmartCrusher: { crush: (content: string) => string };
    ASTCompressor: { compress: (content: string) => string };
    CacheAligner: { align: (content: string) => string };
    HookManager: {
      runHook: (
        name: string,
        phase: string,
        ctx: unknown,
        result?: unknown,
      ) => { success: boolean; error?: string };
    };
  },
): Promise<{ content: { type: string; text: string }[] }> {
  const content = String(args?.content || "");
  const forceCcr = Boolean(args?.forceCcr);
  const userType = String(args?.contentType || "auto");
  const threshold =
    args?.ccrThreshold !== undefined ? Number(args.ccrThreshold) : 1000;

  const preHook = deps.HookManager.runHook("pre-analyze", "analyze", {
    content,
    contentType: userType,
    forceCcr,
    ccrThreshold: threshold,
  });
  if (!preHook.success) {
    throw new Error(`[Hook Blocked] pre-analyze: ${preHook.error}`);
  }

  const detectedType =
    userType === "auto" ? deps.ContentRouter.classify(content) : userType;
  let compressed = content;

  if (detectedType === "json") {
    compressed = deps.SmartCrusher.crush(content);
  } else if (detectedType === "code") {
    compressed = deps.ASTCompressor.compress(content);
  } else if (detectedType === "prose") {
    compressed = deps.CacheAligner.align(content);
  }

  const useCcr = forceCcr || content.length > threshold;
  const resultHash = deps.getCCR().store(content, detectedType);

  const responseObj = useCcr
    ? {
        compressed: resultHash,
        hash: resultHash,
        wasStoredInCcr: true,
        type: detectedType,
      }
    : {
        compressed,
        hash: resultHash,
        wasStoredInCcr: false,
        type: detectedType,
      };

  deps.HookManager.runHook(
    "post-analyze",
    "analyze",
    { content, contentType: userType, forceCcr, ccrThreshold: threshold },
    responseObj,
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(responseObj, null, 2),
      },
    ],
  };
}
