#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ContextCompressor } from "./core/compressor.js";
import { buildInstructions, namespaceOfTool } from "./core/catalog.js";
import { loadConfig } from "./core/config.js";
import { blockedResult, HookEngine } from "./core/hooks.js";
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
import { RagStore } from "./local/rag/store.js";
import { createPipelineTools } from "./pipelines/index.js";

function readArgs(argv: string[]): {
  configPath?: string;
  verbose: boolean;
  error?: string;
} {
  let configPath: string | undefined;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" || arg === "-c") {
      // A trailing `--config` would otherwise start the gateway on defaults,
      // silently ignoring the path the user meant to pass.
      if (argv[i + 1] === undefined) {
        return { configPath, verbose, error: "--config requires a path" };
      }
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

async function main(): Promise<void> {
  if (parsed.error) throw new Error(parsed.error);
  const config = loadConfig(parsed.configPath);

  const compressor = new ContextCompressor(config.compression);
  const hooks = new HookEngine(config.hooks);
  const memory = new MemoryStore(config.memory);
  const rag = new RagStore(config.rag);
  const clients = config.downstreams.map(
    (entry) => new DownstreamClient(entry),
  );

  const localTools = createLocalTools({
    config,
    compressor,
    memory,
    rag,
    hooks,
  });

  // The server exists before the registry so discovery can announce late
  // arrivals through notifications/tools/list_changed.
  const server = new Server(
    { name: config.server.name, version: config.server.version },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: buildInstructions(config.hooks),
    },
  );

  let registry: ToolRegistry;

  const pipelines = createPipelineTools({
    call: (name, args) => registry.callTool(name, args),
    find: (namespace, candidates) => registry.findTool(namespace, candidates),
    refresh: () => registry.refresh(),
  });

  const statusTool: LocalTool = {
    name: "arive_status",
    // Health stays readable: an envelope would hide the report being asked for.
    compressible: false,
    description:
      "[ARIVE] Gateway health: per-namespace tool counts, downstream connection state, and compression store usage.",
    inputSchema: { type: "object", properties: {} },
    handler: () =>
      textResult({
        server: { name: config.server.name, version: config.server.version },
        namespaces: registry.namespaceSummary(),
        discovery: registry.discoveryState,
        downstreams: clients.map((client) => client.status()),
        compression: compressor.stats(),
        hooks: hooks.stats(),
        local: {
          memoryDb: config.memory.dbPath,
          ragDb: config.rag.dbPath,
        },
        note: "Namespaces with a local adapter (context, search, mem, rag) stay available even when no downstream server is configured.",
      }),
  };

  registry = new ToolRegistry(
    clients,
    [...localTools, ...pipelines, statusTool],
    () => {
      void server
        .sendToolListChanged()
        .catch((error: unknown) =>
          log("warn", "tools/list_changed failed", {
            error: errorMessage(error),
          }),
        );
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

    if (shuttingDown) {
      return errorResult("gateway is shutting down", { tool: name });
    }
    inFlight += 1;
    try {
      // Order is fixed: guard, dispatch, compress, annotate. Guidance must
      // never be swallowed by a ctx: envelope, so it is appended last.
      const outcome = await hooks.checkCall(name, args);
      if (outcome.blocked) return blockedResult(outcome);
      const result = await registry.callTool(name, args);
      return hooks.annotate(name, applyCompression(name, result), outcome);
    } catch (error) {
      log("error", `tool ${name} failed`, { error: errorMessage(error) });
      return errorResult(errorMessage(error), { tool: name });
    } finally {
      inFlight -= 1;
    }
  });

  function applyCompression(
    name: string,
    result: CallToolResult,
  ): CallToolResult {
    if (!config.compression.enabled) return result;
    if (!registry.isCompressible(name)) return result;
    // A gateway-level tool (arive_reasoned_debug) has no namespace to ask, so
    // it follows the global threshold like everything else.
    return compressor.apply(result, namespaceOfTool(name) ?? "arive");
  }

  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let inFlight = 0;
  const DRAIN_TIMEOUT_MS = 5_000;

  /**
   * Repeated signals must not restart the drain: a second call returns the
   * first one's promise, so its caller waits for the same flush and close
   * instead of exiting under them.
   */
  const shutdown = (reason: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    log("info", `shutting down (${reason})`);
    shutdownPromise = (async () => {
      // Calls already accepted must finish: closing the clients under a running
      // tool call turns a slow answer into a transport error.
      const deadline = Date.now() + DRAIN_TIMEOUT_MS;
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (inFlight > 0) {
        log(
          "warn",
          `abandoning ${inFlight} in-flight call(s) after drain timeout`,
        );
      }
      // A ref already handed to a client must survive the restart it implies.
      try {
        await compressor.flush();
      } catch (error) {
        log("warn", `compression flush failed: ${errorMessage(error)}`);
      }
      await Promise.allSettled(clients.map((client) => client.close()));
      try {
        memory.close();
      } catch (error) {
        log("warn", `memory close failed: ${errorMessage(error)}`);
      }
      try {
        rag.close();
      } catch (error) {
        log("warn", `rag close failed: ${errorMessage(error)}`);
      }
    })();
    return shutdownPromise;
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
    log("info", `${config.server.name} ${config.server.version} ready`, {
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
