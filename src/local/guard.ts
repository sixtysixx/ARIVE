import type { HookEngine } from "../core/hooks.js";
import {
  optionalBoolean,
  optionalString,
  requireString,
  textResult,
  type LocalTool,
} from "../core/results.js";

export function createGuardTools(hooks: HookEngine): LocalTool[] {
  return [
    {
      name: "arive_guard",
      // The answer is the point: an envelope would hide the abort decision.
      compressible: false,
      description:
        "[ARIVE] Evaluate guard rules against generated text before submitting or committing it. Returns abort:true with the rule's guidance when a text-scope guard matches; pass includeRules:true to receive the rule set.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Generated text to check against text-scope rules.",
          },
          tool: {
            type: "string",
            description:
              "Narrow the check to rules that target this tool name.",
          },
          includeRules: {
            type: "boolean",
            description: "Include the configured rule set in the response.",
            default: false,
          },
        },
        required: ["text"],
      },
      handler: async (args) => {
        const text = requireString(args, "text", "arive_guard");
        const tool = optionalString(args, "tool");
        const includeRules = optionalBoolean(args, "includeRules") ?? false;
        const outcome = await hooks.checkText(text, tool);
        return textResult({
          blocked: outcome.blocked,
          // The client contract: abort the output, re-issue with `reminder`.
          abort: outcome.blocked,
          violations: outcome.violations,
          ...(outcome.degraded.length ? { degraded: outcome.degraded } : {}),
          ...(outcome.blocked
            ? {
                reminder: `<system-reminder>\n${outcome.violations
                  .filter((violation) => violation.action === "block")
                  .map((violation) => violation.guidance)
                  .join("\n")}\n</system-reminder>`,
              }
            : {}),
          ...(includeRules ? { rules: hooks.describe() } : {}),
        });
      },
    },
  ];
}
