import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { NAMESPACES, type Namespace } from "./config.js";
import type { DownstreamClient } from "./mcp-client.js";
import {
  errorResult,
  type JsonObject,
  type LocalTool,
} from "./results.js";
import { errorMessage, log } from "./log.js";

interface Route {
  kind: "local" | "downstream";
  namespace: Namespace;
  local?: LocalTool;
  client?: DownstreamClient;
  remoteName?: string;
}

export function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export class ToolRegistry {
  private readonly routes = new Map<string, Route>();
  private readonly clients: DownstreamClient[];
  private readonly locals: LocalTool[];
  private readonly localNames: Set<string>;
  private discovered = false;
  private discoveryErrors = new Map<Namespace, string>();

  constructor(clients: DownstreamClient[], locals: LocalTool[]) {
    this.clients = clients;
    this.locals = locals;
    this.localNames = new Set(locals.map((tool) => tool.name));
  }

  /** Discovers every enabled downstream concurrently and rebuilds the route table. */
  async refresh(): Promise<void> {
    const enabled = this.clients.filter((client) => client.enabled);
    const results = await Promise.allSettled(
      enabled.map(async (client) => ({
        namespace: client.namespace,
        tools: await client.listTools(),
      })),
    );

    this.routes.clear();
    this.discoveryErrors.clear();

    for (const tool of this.locals) {
      this.routes.set(tool.name, {
        kind: "local",
        namespace: namespaceOf(tool.name),
        local: tool,
      });
    }

    // Local adapters win collisions so that context refs and pipeline
    // primitives cannot be shadowed by a downstream server.
    for (const result of results) {
      if (result.status === "rejected") continue;
      const { namespace, tools } = result.value;
      for (const tool of tools) {
        const exposed = `${namespace}_${sanitizeToolName(
          tool.name.replace(new RegExp(`^${namespace}_`), ""),
        )}`;
        if (this.routes.has(exposed)) {
          log("debug", `skipping duplicate tool ${exposed} from ${namespace}`);
          continue;
        }
        this.routes.set(exposed, {
          kind: "downstream",
          namespace,
          client: this.clients.find((c) => c.namespace === namespace),
          remoteName: tool.name,
        });
      }
    }

    for (const result of results) {
      if (result.status === "rejected") {
        const message = errorMessage(result.reason);
        const namespace = namespaceFromError(enabled, message);
        if (namespace) this.discoveryErrors.set(namespace, message);
        log("warn", `downstream discovery failed: ${message}`);
      }
    }

    this.discovered = true;
  }

  /** Returns every tool with strict namespace prefixes applied. */
  async listTools(): Promise<Tool[]> {
    if (!this.discovered) await this.refresh();
    const tools: Tool[] = [];
    for (const [name, route] of this.routes) {
      if (route.kind === "local" && route.local) {
        tools.push({
          name,
          description: route.local.description,
          inputSchema: route.local.inputSchema as unknown as Tool["inputSchema"],
        });
      }
    }

    for (const client of this.clients) {
      if (!client.enabled) continue;
      let remote: Tool[];
      try {
        remote = await client.listTools();
      } catch {
        continue;
      }
      for (const tool of remote) {
        const exposed = `${client.namespace}_${sanitizeToolName(
          tool.name.replace(new RegExp(`^${client.namespace}_`), ""),
        )}`;
        const route = this.routes.get(exposed);
        if (!route || route.kind !== "downstream" || route.client !== client) {
          continue;
        }
        tools.push({
          ...tool,
          name: exposed,
          description: `[${client.namespace.toUpperCase()}] ${tool.description ?? tool.title ?? tool.name}`,
        });
      }
    }

    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  async callTool(name: string, args: JsonObject): Promise<CallToolResult> {
    let route = this.routes.get(name);

    if (!route) {
      if (!this.discovered) {
        await this.refresh();
        route = this.routes.get(name);
      }
      if (!route) {
        return errorResult(
          `Unknown tool "${name}". Use the exact namespaced name returned by tools/list (for example think_sequentialthinking or context_compress).`,
          { namespaces: this.namespaceSummary() },
        );
      }
    }

    if (route.kind === "local") {
      if (!route.local) return errorResult(`Local tool "${name}" is not wired.`);
      return route.local.handler(args);
    }

    if (!route.client || !route.remoteName) {
      return errorResult(`Tool "${name}" has no downstream client.`);
    }

    try {
      return await route.client.callTool(route.remoteName, args);
    } catch (error) {
      return errorResult(errorMessage(error), {
        tool: name,
        namespace: route.namespace,
      });
    }
  }

  /** Finds the routed name for a downstream tool by candidate remote names. */
  findTool(namespace: Namespace, candidates: string[]): string | undefined {
    const lowered = candidates.map((candidate) => candidate.toLowerCase());
    for (const [exposed, route] of this.routes) {
      if (route.namespace !== namespace) continue;
      const remote =
        route.kind === "local" ? route.local?.name : route.remoteName;
      if (!remote) continue;
      const short = remote
        .replace(new RegExp(`^${namespace}_`), "")
        .toLowerCase();
      if (lowered.includes(short) || lowered.includes(remote.toLowerCase())) {
        return exposed;
      }
    }
    // Fall back to suffix matching for names like "rust_analyzer_diagnostics".
    for (const [exposed, route] of this.routes) {
      if (route.namespace !== namespace) continue;
      const remote =
        route.kind === "local" ? route.local?.name : route.remoteName;
      if (!remote) continue;
      const short = remote.toLowerCase();
      if (lowered.some((candidate) => short.endsWith(candidate))) {
        return exposed;
      }
    }
    return undefined;
  }

  toolCount(namespace: Namespace): number {
    let count = 0;
    for (const route of this.routes.values()) {
      if (route.namespace !== namespace) continue;
      if (route.kind === "downstream" || route.local?.name.startsWith(`${namespace}_`)) {
        count += 1;
      }
    }
    return count;
  }

  namespaceSummary(): Record<string, { tools: number; error?: string }> {
    const summary: Record<string, { tools: number; error?: string }> = {};
    for (const namespace of NAMESPACES) {
      const error = this.discoveryErrors.get(namespace);
      summary[namespace] = {
        tools: this.toolCount(namespace),
        ...(error ? { error } : {}),
      };
    }
    return summary;
  }
}

function namespaceOf(name: string): Namespace {
  const prefix = name.split("_")[0];
  return (NAMESPACES as readonly string[]).includes(prefix)
    ? (prefix as Namespace)
    : "context";
}

function namespaceFromError(
  clients: DownstreamClient[],
  message: string,
): Namespace | undefined {
  return clients.find((client) => message.includes(`"${client.namespace}"`))
    ?.namespace;
}
