import { NAMESPACES, type HooksConfig, type Namespace } from "./config.js";

/**
 * The one place a namespace's name, summary, and compression policy live.
 * The server instructions, the README table, and the compression exemptions all
 * derive from here: three copies of this knowledge is how they drifted apart.
 */
export interface NamespaceInfo {
  prefix: Namespace;
  summary: string;
  /** Oversized results in this namespace are replaced by a `ctx:` envelope. */
  compressible: boolean;
}

export const NAMESPACE_INFO: Record<Namespace, NamespaceInfo> = {
  think: { prefix: "think", summary: "sequential thinking", compressible: true },
  mem: { prefix: "mem", summary: "spatial memory (SQLite)", compressible: true },
  lsp: {
    prefix: "lsp",
    summary: "language-server diagnostics and speculation",
    compressible: true,
  },
  dap: { prefix: "dap", summary: "debugger inspection", compressible: true },
  search: {
    prefix: "search",
    summary: "ripgrep search and file listing",
    compressible: true,
  },
  context: {
    prefix: "context",
    summary: "reversible compression",
    compressible: false,
  },
  rag: {
    prefix: "rag",
    summary: "hybrid retrieval over an indexed corpus",
    compressible: false,
  },
};

/** Resolves the namespace prefix of an exposed tool name, if it has one. */
export function namespaceOfTool(name: string): Namespace | undefined {
  const prefix = name.split("_")[0];
  return (NAMESPACES as readonly string[]).includes(prefix)
    ? (prefix as Namespace)
    : undefined;
}

function guardSection(hooks: HooksConfig): string {
  if (!hooks.enabled || hooks.guards.length === 0) return "";
  const rules = hooks.guards
    .map((rule) => `${rule.id} (${rule.scope}) — ${rule.description ?? rule.guidance}`)
    .join("; ");
  return (
    `Guard rules are enforced before every tool call: a call matching a rule returns that rule's guidance instead of executing, so fix the arguments and retry. Rules: ${rules}. ` +
    "Call arive_guard with generated text to check it against text-scope rules before committing it."
  );
}

/** Renders the MCP `instructions` string the gateway advertises. */
export function buildInstructions(hooks: HooksConfig): string {
  const namespaces = NAMESPACES.map(
    (prefix) => `${prefix}_* (${NAMESPACE_INFO[prefix].summary})`,
  ).join(", ");

  const sentences = [
    `ARIVE gateway. Every tool is namespaced: ${namespaces}.`,
    "Oversized outputs are replaced by an envelope containing a ctx: reference; call context_retrieve with that ref to recover the original losslessly.",
    "Use arive_reasoned_debug for reflection plus debugger inspection.",
    "Call arive_status to see which namespaces are live before relying on a downstream tool.",
    "Downstream tools are discovered after startup; the gateway emits notifications/tools/list_changed when the tool list changes.",
  ];

  const guards = guardSection(hooks);
  if (guards) sentences.push(guards);
  return sentences.join(" ");
}
