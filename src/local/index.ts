import type { ContextCompressor } from "../core/compressor.js";
import type { AriveConfig } from "../core/config.js";
import type { HookEngine } from "../core/hooks.js";
import type { LocalTool } from "../core/results.js";
import { createContextTools } from "./context.js";
import { createFableTools } from "./fable/index.js";
import { createGuardTools } from "./guard.js";
import { createMemoryTools, MemoryStore } from "./memory.js";
import { RagStore } from "./rag/store.js";
import { createRagTools } from "./rag/tools.js";
import { createSearchTools } from "./search.js";

export interface LocalToolOptions {
  config: AriveConfig;
  compressor: ContextCompressor;
  memory: MemoryStore;
  rag: RagStore;
  hooks: HookEngine;
}

export function createLocalTools(options: LocalToolOptions): LocalTool[] {
  return [
    ...createFableTools(),
    ...createGuardTools(options.hooks),
    ...createContextTools(options.compressor),
    ...createSearchTools(options.config.search.maxResults),
    ...createMemoryTools(options.memory),
    ...createRagTools(options.rag),
  ];
}
