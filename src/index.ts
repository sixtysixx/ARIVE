#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ContextCompressor } from "./core/compressor.js";
import { loadConfig, NAMESPACES, type Namespace } from "./core/config.js";
import { errorMessage, log } from "./core/log.js";
import { DownstreamClient } from "./core/mcp-client.js";
import { ToolRegistry } from "./core/registry.js";
import {
  asObject,
  errorResult,
  textResult,
  type LocalTool,
} from "./core/results.js";
import { createLocalTools } from "./local/index.js";
import { MemoryStore } from "./local/memory.js";
import { createPipelineTools } from "./pipelines/index.js";

const VERSION = "1.0.0";

function readArgs(argv: string[]): { configPath?: string; verbose: boolean } {
  let configPath: string | undefined;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" || arg === "-c") {
      configPath = argv[i + 1];
      i += 1;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    }
  }
  return { configPath, verbose };
}

const parsed = readArgs(process.argv.slice(2));
if (parsed.verbose) process.env.ARIVE_LOG = "debug";

function main(): Promise<void> {
  const config = loadConfig(parsed.configPath);

  const compressor = new ContextCompressor(config.compression);
  const memory = new MemoryStore(config.memory);
  const clients = config.downstreams.map(
    (entry) => new DownstreamClient(entry),
  );

  const localTools = createLocalTools({ config, compressor, memory });

  let registry: ToolRegistry;

  const pipelines = createPipelineTools({
    call: (name, args) => registry.callTool(name, args),
    find: (namespace, candidates) => registry.findTool(namespace, candidates),
    refresh: () => registry.refresh(),
  });

  const statusTool: LocalTool = {
    name: "arive_status",
    description:
      "[ARIVE] Gateway health: per-namespace tool counts, downstream connection state, and compression store usage.",
    inputSchema: { type: "object", properties: {} },
    handler: () =>
      textResult({
        server: { name: config.server.name, version: VERSION },
        namespaces: registry.namespaceSummary(),
        downstreams: clients.map((client) => client.status()),
        compression: compressor.stats(),
        local: {
          memoryDb: config.memory.dbPath,
        },
        note: "Namespaces with a local adapter (context, search, mem) stay available even when no downstream server is configured.",
      }),
  };

  registry = new ToolRegistry(clients, [
    ...localTools,
    ...pipelines,
    statusTool,
  ]);

  const server = new Server(
    { name: config.server.name, version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "ARIVE gateway. Every tool is namespaced: think_* (sequential thinking), lsp_*, dap_*, search_* (ripgrep), mem_* (spatial memory), context_* (reversible compression). " +
        "Oversized outputs are replaced by an envelope containing a ctx: reference; call context_retrieve with that ref to recover the original losslessly. " +
        "Use arive_reasoned_debug for reflection plus debugger inspection. " +
        "Call arive_status to see which namespaces are live before relying on a downstream tool.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await registry.listTools();
    log("debug", `tools/list -> ${tools.length} tools`);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = asObject(request.params.arguments);

    try {
      const result = await registry.callTool(name, args);
      return applyCompression(name, result);
    } catch (error) {
      log("error", `tool ${name} failed`, { error: errorMessage(error) });
      return errorResult(errorMessage(error), { tool: name });
    }
  });

  function namespaceOfTool(name: string): Namespace | undefined {
    const prefix = name.split("_")[0];
    return (NAMESPACES as readonly string[]).includes(prefix)
      ? (prefix as Namespace)
      : undefined;
  }

  function applyCompression(
    name: string,
    result: CallToolResult,
  ): CallToolResult {
    // The retrieval path must never compress its own payload, and context
    // envelopes are already compressed by definition.
    if (!config.compression.enabled || name === "context_retrieve")
      return result;
    const namespace = namespaceOfTool(name);
    if (!namespace || namespace === "context") return result;

    const downstream = clients.find((client) => client.namespace === namespace);
    if (downstream?.enabled && !downstream.compress) return result;

    return compressor.apply(result, namespace);
  }

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `shutting down (${reason})`);
    await Promise.allSettled(clients.map((client) => client.close()));
    try {
      memory.close();
    } catch (error) {
      log("warn", `memory close failed: ${errorMessage(error)}`);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT").then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").then(() => process.exit(0));
  });
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled rejection", { reason: errorMessage(reason) });
  });

  return (async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("info", `${config.server.name} ${VERSION} ready`, {
      downstreams: clients
        .filter((client) => client.enabled)
        .map((client) => client.namespace),
      compression: config.compression.enabled
        ? `${config.compression.thresholdTokens} tokens`
        : "disabled",
    });
  })();
}

main().catch((error: unknown) => {
  process.stderr.write(`[arive] fatal: ${errorMessage(error)}\n`);
  process.exit(1);
});
