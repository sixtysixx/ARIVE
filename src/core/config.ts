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

export interface AriveConfig {
  server: { name: string; version: string };
  compression: CompressionConfig;
  memory: { dbPath: string; maxItems: number };
  search: { maxResults: number };
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
 * Missing files are not an error: built-in defaults apply.
 */
export function loadConfig(explicitPath?: string): AriveConfig {
  const candidates = [
    explicitPath,
    process.env.ARIVE_CONFIG,
    path.resolve(process.cwd(), "arive.config.json"),
  ].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );

  let raw: unknown = {};
  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (!fs.existsSync(resolved)) continue;
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
