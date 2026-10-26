import type { ContextCompressor } from "../core/compressor.js";
import {
  errorResult,
  optionalBoolean,
  optionalString,
  requireString,
  textResult,
  type LocalTool,
} from "../core/results.js";

export function createContextTools(compressor: ContextCompressor): LocalTool[] {
  return [
    {
      name: "context_compress",
      description:
        "[CONTEXT] Compress an oversized payload into a reversible ctx: reference. The original is retained losslessly and can be recovered with context_retrieve.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Payload to compress." },
          force: {
            type: "boolean",
            description: "Store even when the payload is under the threshold.",
            default: false,
          },
          contentType: {
            type: "string",
            enum: ["auto", "json", "text", "logs"],
            default: "auto",
          },
        },
        required: ["content"],
      },
      handler: (args) => {
        const content = requireString(args, "content", "context_compress");
        const force = optionalBoolean(args, "force") ?? false;
        const namespace = optionalString(args, "contentType") ?? "context";
        const result = compressor.compressText(content, namespace, force);
        if (!result.compressed) {
          return textResult({
            compressed: false,
            originalChars: content.length,
            thresholdTokens: compressor.stats().thresholdTokens,
            reason:
              "Payload is under the configured threshold; pass force:true to store it anyway.",
          });
        }
        return textResult({
          compressed: true,
          ref: result.ref,
          envelope: result.text,
        });
      },
    },
    {
      name: "context_retrieve",
      description:
        "[CONTEXT] Resolve a ctx: reference back to the exact original payload. Never compressed itself.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Reference such as ctx:ab12…." },
        },
        required: ["ref"],
      },
      handler: (args) => {
        const ref = requireString(args, "ref", "context_retrieve");
        const original = compressor.retrieve(ref);
        if (original === null) {
          return errorResult(
            `No stored payload for "${ref}". It may have been evicted or the server may have restarted without a storeDir.`,
          );
        }
        return textResult({ ref, content: original });
      },
    },
    {
      name: "context_stats",
      description: "[CONTEXT] Report compression store usage and thresholds.",
      inputSchema: { type: "object", properties: {} },
      handler: () => textResult(compressor.stats()),
    },
  ];
}
