import { namespaceOfTool } from "../core/catalog.js";
import {
  optionalString,
  textResult,
  type LocalTool,
} from "../core/results.js";
import type { NamespaceHealth } from "../core/registry.js";

export interface CapabilityEntry {
  tool: string;
  useWhen: string;
}

/**
 * The job-to-tool map. It lives beside the tools it names so a new capability
 * is one line here instead of a paragraph each client has to be told.
 */
export const ARIVE_CAPABILITIES: CapabilityEntry[] = [
  { tool: "search_query", useWhen: "locate code or text in the working tree by pattern" },
  { tool: "search_files", useWhen: "enumerate files before deciding what to read" },
  { tool: "rag_index", useWhen: "build a retrieval corpus over a large tree" },
  { tool: "rag_query", useWhen: "recall passages without knowing where they live" },
  { tool: "mem_remember", useWhen: "persist a decision, rule, or finding across sessions" },
  { tool: "mem_recall", useWhen: "before re-deriving an earlier decision" },
  { tool: "context_retrieve", useWhen: "recover a payload replaced by a ctx: reference" },
  { tool: "arive_guard", useWhen: "check generated text against the configured guard rules" },
  { tool: "arive_reasoned_debug", useWhen: "debug a failure with reflection plus debugger inspection" },
  { tool: "fable_method", useWhen: "load the problem-solving loop, its references, or a domain adapter" },
  { tool: "fable_plan", useWhen: "turn a non-trivial or plan-first ask into a plan artifact before acting" },
  { tool: "fable_judge", useWhen: "before claiming work is done: verdict each claim against what was observed" },
  { tool: "lh_start_run", useWhen: "hand a multi-round or unattended task to the manager/executor/auditor loop" },
  { tool: "lh_run_status", useWhen: "poll a run; steer it with lh_inject_feedback and stop it with lh_stop_run" },
];

export function createCapabilityTool(deps: {
  instructions: string;
  summary: () => Record<string, NamespaceHealth>;
}): LocalTool {
  return {
    name: "arive_capabilities",
    compressible: false,
    description:
      "[ARIVE] Start here in a new session: the job-to-tool map for this gateway, each entry's use-when trigger, and whether its namespace is live right now.",
    inputSchema: {
      type: "object",
      properties: {
        job: {
          type: "string",
          description:
            "Optional substring filter over tool names and use-when text.",
        },
      },
    },
    handler: (args) => {
      const job = optionalString(args, "job")?.toLowerCase();
      const summary = deps.summary();
      const entries = ARIVE_CAPABILITIES.filter((entry) => {
        if (job === undefined) return true;
        return `${entry.tool} ${entry.useWhen}`.toLowerCase().includes(job);
      }).map((entry) => {
        const namespace = namespaceOfTool(entry.tool);
        // A gateway tool has no namespace to ask; it is always reachable.
        const available =
          namespace === undefined || summary[namespace]?.usable === true;
        return { ...entry, available };
      });

      return textResult({
        instructions: deps.instructions,
        capabilities: entries,
        namespaces: summary,
      });
    },
  };
}
