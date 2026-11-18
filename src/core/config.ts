import * as fs from "fs";
import * as path from "path";
import { errorMessage, log } from "./log.js";
import { VERSION } from "./version.js";

export const NAMESPACES = [
  "think",
  "mem",
  "lsp",
  "dap",
  "search",
  "context",
  "rag",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export interface DownstreamConfig {
  namespace: Namespace;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  connectTimeoutMs: number;
  callTimeoutMs: number;
  /** Compress this namespace's oversized results before returning them. */
  compress: boolean;
}

export interface CompressionConfig {
  enabled: boolean;
  /** Approximate token threshold; estimated at 4 characters per token. */
  thresholdTokens: number;
  maxEntries: number;
  previewChars: number;
  /** Optional directory for on-disk retention so refs survive restarts. */
  storeDir?: string;
}

export type EmbeddingProviderKind = "none" | "ollama" | "openai";

export interface RagEmbeddingConfig {
  provider: EmbeddingProviderKind;
  model?: string;
  baseUrl?: string;
  apiKeyEnv: string;
  batchSize: number;
  timeoutMs: number;
}

export interface RagConfig {
  dbPath: string;
  chunkChars: number;
  chunkOverlapChars: number;
  maxFileBytes: number;
  maxFiles: number;
  defaultTopK: number;
  maxTopK: number;
  maxPerFile: number;
  maxVectorScan: number;
  embeddings: RagEmbeddingConfig;
}

/** What a guard rule inspects: a tool call's arguments, generated text, or both. */
export type HookScope = "args" | "text" | "both";
export type HookAction = "block" | "warn";

export interface AstConditionConfig {
  pattern: string;
  lang: string;
  selector?: string;
  strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
}

export interface GuardRuleConfig {
  id: string;
  description?: string;
  scope: HookScope;
  /** Regex tested against the tool name; absent matches every tool. */
  tool?: string;
  condition?: string;
  astCondition?: AstConditionConfig;
  action: HookAction;
  guidance: string;
}

export interface DocHookConfig {
  id: string;
  tool: string;
  title?: string;
  text: string;
}

export interface HooksConfig {
  enabled: boolean;
  /** Characters of a call's arguments or of supplied text scanned per rule. */
  maxScanChars: number;
  astTimeoutMs: number;
  onAstError: "skip" | "block";
  guards: GuardRuleConfig[];
  docs: DocHookConfig[];
}

export interface AriveConfig {
  server: { name: string; version: string };
  compression: CompressionConfig;
  memory: { dbPath: string; maxItems: number };
  search: { maxResults: number };
  rag: RagConfig;
  hooks: HooksConfig;
  downstreams: DownstreamConfig[];
}

const DEFAULT_DOWNSTREAMS: DownstreamConfig[] = [
  {
    namespace: "think",
    enabled: true,
    command: "bun",
    args: ["x", "--silent", "@modelcontextprotocol/server-sequential-thinking"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 60_000,
    compress: true,
  },
  {
    namespace: "lsp",
    enabled: true,
    command: "bun",
    args: ["x", "--silent", "agent-lsp"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 120_000,
    compress: true,
  },
  {
    namespace: "dap",
    enabled: true,
    command: "bun",
    args: ["x", "--silent", "dap-mcp"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 120_000,
    compress: true,
  },
  // These three are served in-process by local adapters. Enable a downstream
  // entry only if you want to override the adapter with a real server.
  {
    namespace: "search",
    enabled: false,
    command: "bun",
    args: ["x", "--silent", "mcp-ripgrep"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 60_000,
    compress: true,
  },
  {
    namespace: "context",
    enabled: false,
    command: "bun",
    args: ["x", "--silent", "github:headroomlabs-ai/headroom"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 60_000,
    compress: false,
  },
  {
    namespace: "mem",
    enabled: false,
    command: "bun",
    args: ["x", "--silent", "github:MemPalace/mempalace"],
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 60_000,
    compress: true,
  },
  {
    namespace: "rag",
    enabled: false,
    command: "uvx",
    args: ["mcp-server-qdrant"], // official Qdrant RAG server; needs uv + Qdrant only if enabled
    env: {},
    connectTimeoutMs: 20_000,
    callTimeoutMs: 60_000,
    compress: true,
  },
];

const DEFAULT_CONFIG: AriveConfig = {
  server: { name: "arive", version: VERSION },
  compression: {
    enabled: true,
    thresholdTokens: 2000,
    maxEntries: 500,
    previewChars: 600,
  },
  memory: { dbPath: ".arive/memory.db", maxItems: 50_000 },
  search: { maxResults: 50 },
  rag: {
    dbPath: ".arive/rag.db",
    chunkChars: 1200,
    chunkOverlapChars: 200,
    maxFileBytes: 1_000_000,
    maxFiles: 20_000,
    defaultTopK: 8,
    maxTopK: 50,
    maxPerFile: 3,
    maxVectorScan: 50_000,
    embeddings: {
      provider: "none",
      apiKeyEnv: "OPENAI_API_KEY",
      batchSize: 32,
      timeoutMs: 30_000,
    },
  },
  hooks: {
    enabled: true,
    maxScanChars: 20_000,
    astTimeoutMs: 3_000,
    onAstError: "skip",
    guards: [],
    docs: [],
  },
  downstreams: DEFAULT_DOWNSTREAMS,
};

export function defaultConfig(): AriveConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNamespace(value: unknown): value is Namespace {
  return (
    typeof value === "string" &&
    (NAMESPACES as readonly string[]).includes(value)
  );
}

const HOOK_SCOPES: readonly HookScope[] = ["args", "text", "both"];
const HOOK_ACTIONS: readonly HookAction[] = ["block", "warn"];
const AST_STRICTNESS: readonly NonNullable<
  AstConditionConfig["strictness"]
>[] = ["cst", "smart", "ast", "relaxed", "signature", "template"];
const GUARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_DOC_TEXT_CHARS = 8_000;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Compiles an author-supplied pattern, naming the field that is wrong. */
function compileHookPattern(source: unknown, field: string, index: number): RegExp {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(
      `Invalid hooks.guards[${index}]: ${field} must be a non-empty string`,
    );
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(
      `Invalid hooks.guards[${index}]: ${field} is not a valid regular expression (${errorMessage(error)})`,
    );
  }
}

function parseAstCondition(
  value: unknown,
  index: number,
): AstConditionConfig {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid hooks.guards[${index}]: astCondition must be an object`,
    );
  }
  const pattern = nonEmptyString(value.pattern);
  if (!pattern) {
    throw new Error(
      `Invalid hooks.guards[${index}]: astCondition.pattern must be a non-empty string`,
    );
  }
  const lang = nonEmptyString(value.lang);
  if (!lang) {
    throw new Error(
      `Invalid hooks.guards[${index}]: astCondition.lang must be a non-empty string`,
    );
  }
  const selector = nonEmptyString(value.selector);
  if (value.selector !== undefined && !selector) {
    throw new Error(
      `Invalid hooks.guards[${index}]: astCondition.selector must be a non-empty string`,
    );
  }
  let strictness: AstConditionConfig["strictness"];
  if (value.strictness !== undefined) {
    if (
      !AST_STRICTNESS.includes(
        value.strictness as AstConditionConfig["strictness"] & string,
      )
    ) {
      throw new Error(
        `Invalid hooks.guards[${index}]: astCondition.strictness must be one of ${AST_STRICTNESS.join(", ")}`,
      );
    }
    strictness = value.strictness as AstConditionConfig["strictness"];
  }
  return {
    pattern,
    lang,
    ...(selector ? { selector } : {}),
    ...(strictness ? { strictness } : {}),
  };
}

function parseGuardRule(value: unknown, index: number): GuardRuleConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid hooks.guards[${index}]: expected an object`);
  }
  const id = value.id;
  if (typeof id !== "string" || !GUARD_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid hooks.guards[${index}]: id must be letters, digits, underscores, or hyphens, starting with a letter or digit`,
    );
  }
  const scope = value.scope ?? "args";
  if (!HOOK_SCOPES.includes(scope as HookScope)) {
    throw new Error(
      `Invalid hooks.guards[${index}]: scope must be one of ${HOOK_SCOPES.join(", ")}`,
    );
  }
  const action = value.action ?? "block";
  if (!HOOK_ACTIONS.includes(action as HookAction)) {
    throw new Error(
      `Invalid hooks.guards[${index}]: action must be one of ${HOOK_ACTIONS.join(", ")}`,
    );
  }
  const guidance = nonEmptyString(value.guidance);
  if (!guidance) {
    throw new Error(
      `Invalid hooks.guards[${index}]: guidance must be a non-empty string`,
    );
  }
  const tool =
    value.tool === undefined
      ? undefined
      : compileHookPattern(value.tool, "tool", index).source;
  const condition =
    value.condition === undefined
      ? undefined
      : compileHookPattern(value.condition, "condition", index).source;
  const astCondition =
    value.astCondition === undefined
      ? undefined
      : parseAstCondition(value.astCondition, index);

  if (condition === undefined && astCondition === undefined) {
    throw new Error(
      `Invalid hooks.guards[${index}]: a rule needs condition or astCondition`,
    );
  }

  const description = nonEmptyString(value.description);
  return {
    id,
    ...(description ? { description } : {}),
    scope: scope as HookScope,
    ...(tool ? { tool } : {}),
    ...(condition !== undefined ? { condition } : {}),
    ...(astCondition ? { astCondition } : {}),
    action: action as HookAction,
    guidance,
  };
}

function parseDocHook(value: unknown, index: number): DocHookConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid hooks.docs[${index}]: expected an object`);
  }
  const id = value.id;
  if (typeof id !== "string" || !GUARD_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid hooks.docs[${index}]: id must be letters, digits, underscores, or hyphens, starting with a letter or digit`,
    );
  }
  if (typeof value.tool !== "string" || value.tool.trim() === "") {
    throw new Error(
      `Invalid hooks.docs[${index}]: tool must be a non-empty string`,
    );
  }
  try {
    new RegExp(value.tool);
  } catch (error) {
    throw new Error(
      `Invalid hooks.docs[${index}]: tool is not a valid regular expression (${errorMessage(error)})`,
    );
  }
  const text = nonEmptyString(value.text);
  if (!text) {
    throw new Error(
      `Invalid hooks.docs[${index}]: text must be a non-empty string`,
    );
  }
  if (text.length > MAX_DOC_TEXT_CHARS) {
    throw new Error(
      `Invalid hooks.docs[${index}]: text must be at most ${MAX_DOC_TEXT_CHARS} characters`,
    );
  }
  const title = nonEmptyString(value.title);
  return {
    id,
    tool: value.tool,
    ...(title ? { title } : {}),
    text,
  };
}

/** Shallow-merges a raw config over the defaults, merging downstreams by namespace. */
export function mergeConfig(raw: unknown): AriveConfig {
  const base = defaultConfig();
  if (!isRecord(raw)) return base;

  if (isRecord(raw.server)) {
    if (typeof raw.server.name === "string") base.server.name = raw.server.name;
    if (typeof raw.server.version === "string")
      base.server.version = raw.server.version;
  }

  if (isRecord(raw.compression)) {
    const c = raw.compression;
    if (typeof c.enabled === "boolean") base.compression.enabled = c.enabled;
    if (typeof c.thresholdTokens === "number")
      base.compression.thresholdTokens = c.thresholdTokens;
    if (typeof c.maxEntries === "number")
      base.compression.maxEntries = c.maxEntries;
    if (typeof c.previewChars === "number")
      base.compression.previewChars = c.previewChars;
    if (typeof c.storeDir === "string") base.compression.storeDir = c.storeDir;
  }

  if (isRecord(raw.memory)) {
    if (typeof raw.memory.dbPath === "string")
      base.memory.dbPath = raw.memory.dbPath;
    if (typeof raw.memory.maxItems === "number")
      base.memory.maxItems = raw.memory.maxItems;
  }

  if (isRecord(raw.search) && typeof raw.search.maxResults === "number") {
    base.search.maxResults = raw.search.maxResults;
  }

  if (isRecord(raw.rag)) {
    const r = raw.rag;
    if (typeof r.dbPath === "string") base.rag.dbPath = r.dbPath;
    if (typeof r.chunkChars === "number") base.rag.chunkChars = r.chunkChars;
    if (typeof r.chunkOverlapChars === "number")
      base.rag.chunkOverlapChars = r.chunkOverlapChars;
    if (typeof r.maxFileBytes === "number")
      base.rag.maxFileBytes = r.maxFileBytes;
    if (typeof r.maxFiles === "number") base.rag.maxFiles = r.maxFiles;
    if (typeof r.defaultTopK === "number")
      base.rag.defaultTopK = r.defaultTopK;
    if (typeof r.maxTopK === "number") base.rag.maxTopK = r.maxTopK;
    if (typeof r.maxPerFile === "number")
      base.rag.maxPerFile = r.maxPerFile;
    if (typeof r.maxVectorScan === "number")
      base.rag.maxVectorScan = r.maxVectorScan;

    if (isRecord(r.embeddings)) {
      const e = r.embeddings;
      if (typeof e.provider === "string") {
        if (
          e.provider !== "none" &&
          e.provider !== "ollama" &&
          e.provider !== "openai"
        ) {
          throw new Error(
            `Invalid rag.embeddings.provider "${e.provider}"; expected none, ollama, or openai`,
          );
        }
        base.rag.embeddings.provider = e.provider;
      }
      if (typeof e.model === "string" && e.model !== "")
        base.rag.embeddings.model = e.model;
      if (typeof e.baseUrl === "string" && e.baseUrl !== "")
        base.rag.embeddings.baseUrl = e.baseUrl;
      if (typeof e.apiKeyEnv === "string" && e.apiKeyEnv !== "")
        base.rag.embeddings.apiKeyEnv = e.apiKeyEnv;
      if (typeof e.batchSize === "number")
        base.rag.embeddings.batchSize = e.batchSize;
      if (typeof e.timeoutMs === "number")
        base.rag.embeddings.timeoutMs = e.timeoutMs;
    }
  }

  if (isRecord(raw.hooks)) {
    const h = raw.hooks;
    if (typeof h.enabled === "boolean") base.hooks.enabled = h.enabled;
    if (typeof h.maxScanChars === "number")
      base.hooks.maxScanChars = h.maxScanChars;
    if (typeof h.astTimeoutMs === "number")
      base.hooks.astTimeoutMs = h.astTimeoutMs;
    if (h.onAstError === "skip" || h.onAstError === "block") {
      base.hooks.onAstError = h.onAstError;
    }
    // Rules are an ordered list, so a configured array replaces the default
    // and is never merged rule by rule.
    if (h.guards !== undefined) {
      if (!Array.isArray(h.guards)) {
        throw new Error("Invalid hooks.guards: expected an array");
      }
      base.hooks.guards = h.guards.map(parseGuardRule);
    }
    if (h.docs !== undefined) {
      if (!Array.isArray(h.docs)) {
        throw new Error("Invalid hooks.docs: expected an array");
      }
      base.hooks.docs = h.docs.map(parseDocHook);
    }
  }

  if (Array.isArray(raw.downstreams)) {
    const byNamespace = new Map<Namespace, DownstreamConfig>(
      base.downstreams.map((entry) => [entry.namespace, entry]),
    );
    for (const item of raw.downstreams) {
      if (!isRecord(item) || !isNamespace(item.namespace)) {
        throw new Error(
          `Invalid downstream entry: every entry needs a "namespace" from ${NAMESPACES.join(", ")}`,
        );
      }
      const current = byNamespace.get(item.namespace);
      if (!current) continue;
      const merged: DownstreamConfig = { ...current };
      if (typeof item.enabled === "boolean") merged.enabled = item.enabled;
      if (typeof item.command === "string") merged.command = item.command;
      if (Array.isArray(item.args))
        merged.args = item.args.filter(
          (a): a is string => typeof a === "string",
        );
      if (isRecord(item.env)) {
        merged.env = Object.fromEntries(
          Object.entries(item.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
      if (typeof item.cwd === "string") merged.cwd = item.cwd;
      if (typeof item.connectTimeoutMs === "number")
        merged.connectTimeoutMs = item.connectTimeoutMs;
      if (typeof item.callTimeoutMs === "number")
        merged.callTimeoutMs = item.callTimeoutMs;
      if (typeof item.compress === "boolean") merged.compress = item.compress;
      byNamespace.set(item.namespace, merged);
    }
    base.downstreams = [...byNamespace.values()];
  }

  return base;
}

function applyEnvOverrides(config: AriveConfig): void {
  const enable = process.env.ARIVE_ENABLE?.trim();
  const disable = process.env.ARIVE_DISABLE?.trim();

  if (enable) {
    const allowed = new Set(enable.split(",").map((s) => s.trim()));
    for (const d of config.downstreams) {
      if (!allowed.has(d.namespace)) d.enabled = false;
    }
  }
  if (disable) {
    const blocked = new Set(disable.split(",").map((s) => s.trim()));
    for (const d of config.downstreams) {
      if (blocked.has(d.namespace)) d.enabled = false;
    }
  }

  const compress = process.env.ARIVE_COMPRESS;
  if (compress === "0" || compress === "false")
    config.compression.enabled = false;

  const threshold = Number(process.env.ARIVE_COMPRESS_THRESHOLD);
  if (Number.isFinite(threshold) && threshold > 0) {
    config.compression.thresholdTokens = threshold;
  }
  if (process.env.ARIVE_MEMORY_DB)
    config.memory.dbPath = process.env.ARIVE_MEMORY_DB;
  if (process.env.ARIVE_RAG_DB) config.rag.dbPath = process.env.ARIVE_RAG_DB;

  const searchMax = Number(process.env.ARIVE_SEARCH_MAX_RESULTS);
  if (Number.isFinite(searchMax) && searchMax > 0)
    config.search.maxResults = searchMax;
}

function validate(config: AriveConfig): void {
  if (
    !Number.isFinite(config.compression.thresholdTokens) ||
    config.compression.thresholdTokens <= 0
  ) {
    throw new Error("compression.thresholdTokens must be a positive number");
  }
  if (
    !Number.isInteger(config.compression.maxEntries) ||
    config.compression.maxEntries < 1
  ) {
    throw new Error("compression.maxEntries must be an integer >= 1");
  }
  if (
    !Number.isInteger(config.compression.previewChars) ||
    config.compression.previewChars < 0
  ) {
    throw new Error("compression.previewChars must be an integer >= 0");
  }
  if (!Number.isInteger(config.memory.maxItems) || config.memory.maxItems < 1) {
    throw new Error("memory.maxItems must be an integer >= 1");
  }
  if (!Number.isInteger(config.search.maxResults) || config.search.maxResults < 1) {
    throw new Error("search.maxResults must be an integer >= 1");
  }
  if (
    !Number.isInteger(config.hooks.maxScanChars) ||
    config.hooks.maxScanChars < 1
  ) {
    throw new Error("hooks.maxScanChars must be an integer >= 1");
  }
  if (
    !Number.isFinite(config.hooks.astTimeoutMs) ||
    config.hooks.astTimeoutMs <= 0
  ) {
    throw new Error("hooks.astTimeoutMs must be a positive number");
  }
  const rag = config.rag;
  if (!Number.isInteger(rag.chunkChars) || rag.chunkChars < 100) {
    throw new Error("rag.chunkChars must be an integer >= 100");
  }
  if (
    !Number.isInteger(rag.chunkOverlapChars) ||
    rag.chunkOverlapChars < 0 ||
    rag.chunkOverlapChars >= rag.chunkChars
  ) {
    throw new Error(
      "rag.chunkOverlapChars must be an integer >= 0 and less than rag.chunkChars",
    );
  }
  if (!Number.isInteger(rag.maxFileBytes) || rag.maxFileBytes < 1) {
    throw new Error("rag.maxFileBytes must be an integer >= 1");
  }
  if (!Number.isInteger(rag.maxFiles) || rag.maxFiles < 1) {
    throw new Error("rag.maxFiles must be an integer >= 1");
  }
  if (!Number.isInteger(rag.defaultTopK) || rag.defaultTopK < 1) {
    throw new Error("rag.defaultTopK must be an integer >= 1");
  }
  if (
    !Number.isInteger(rag.maxTopK) ||
    rag.maxTopK < rag.defaultTopK ||
    rag.maxTopK > 100
  ) {
    throw new Error(
      "rag.maxTopK must be an integer between rag.defaultTopK and 100",
    );
  }
  if (!Number.isInteger(rag.maxPerFile) || rag.maxPerFile < 1) {
    throw new Error("rag.maxPerFile must be an integer >= 1");
  }
  if (!Number.isInteger(rag.maxVectorScan) || rag.maxVectorScan < 1) {
    throw new Error("rag.maxVectorScan must be an integer >= 1");
  }
  if (
    !Number.isInteger(rag.embeddings.batchSize) ||
    rag.embeddings.batchSize < 1
  ) {
    throw new Error("rag.embeddings.batchSize must be an integer >= 1");
  }
  if (
    !Number.isFinite(rag.embeddings.timeoutMs) ||
    rag.embeddings.timeoutMs <= 0
  ) {
    throw new Error("rag.embeddings.timeoutMs must be a positive number");
  }
  const seen = new Set<Namespace>();
  for (const entry of config.downstreams) {
    if (seen.has(entry.namespace)) {
      throw new Error(`Duplicate downstream namespace: ${entry.namespace}`);
    }
    seen.add(entry.namespace);
    if (entry.enabled && !entry.command.trim()) {
      throw new Error(
        `Downstream "${entry.namespace}" is enabled but has no command`,
      );
    }
    if (
      !Number.isFinite(entry.connectTimeoutMs) ||
      entry.connectTimeoutMs <= 0
    ) {
      throw new Error(
        `Downstream "${entry.namespace}" has an invalid connectTimeoutMs`,
      );
    }
    if (!Number.isFinite(entry.callTimeoutMs) || entry.callTimeoutMs <= 0) {
      throw new Error(
        `Downstream "${entry.namespace}" has an invalid callTimeoutMs`,
      );
    }
  }
}

/**
 * Loads configuration from an explicit path, $ARIVE_CONFIG, or ./arive.config.json.
 * An explicitly requested file that does not exist is an error: silently
 * falling back to defaults hides a typo behind a working gateway.
 */
export function loadConfig(explicitPath?: string): AriveConfig {
  const candidates: Array<{ path: string; required: boolean }> = [];
  if (explicitPath) candidates.push({ path: explicitPath, required: true });
  if (process.env.ARIVE_CONFIG)
    candidates.push({ path: process.env.ARIVE_CONFIG, required: true });
  candidates.push({
    path: path.resolve(process.cwd(), "arive.config.json"),
    required: false,
  });

  let raw: unknown = {};
  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate.path);
    if (!fs.existsSync(resolved)) {
      if (candidate.required) {
        throw new Error(`Config file not found: ${resolved}`);
      }
      continue;
    }
    try {
      raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
    } catch (error) {
      throw new Error(
        `Failed to parse config at ${resolved}: ${errorMessage(error)}`,
      );
    }
    log("info", `loaded config from ${resolved}`);
    break;
  }

  const config = mergeConfig(raw);
  applyEnvOverrides(config);
  validate(config);
  return config;
}
