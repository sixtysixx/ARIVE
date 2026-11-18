import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { NAMESPACE_INFO, namespaceOfTool } from "./catalog.js";
import { NAMESPACES, type Namespace } from "./config.js";
import type { DownstreamClient } from "./mcp-client.js";
import { errorResult, type JsonObject, type LocalTool } from "./results.js";
import { errorMessage, log } from "./log.js";

interface Route {
  kind: "local" | "downstream";
  /** Absent for local tools whose name carries no namespace prefix. */
  namespace?: Namespace;
  local?: LocalTool;
  client?: DownstreamClient;
  remoteName?: string;
  /** Last tool descriptor reported by the downstream, reused for listings. */
  remoteTool?: Tool;
}

/** How long the first `tools/list` may wait for downstream discovery. */
const LIST_GRACE_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export class ToolRegistry {
  private readonly routes = new Map<string, Route>();
  private readonly clients: DownstreamClient[];
  private readonly locals: LocalTool[];
  private readonly onToolsChanged?: () => void;
  private discovered = false;
  private discovering?: Promise<void>;
  private readonly discoveryErrors = new Map<Namespace, string>();

  constructor(
    clients: DownstreamClient[],
    locals: LocalTool[],
    onToolsChanged?: () => void,
  ) {
    this.clients = clients;
    this.locals = locals;
    this.onToolsChanged = onToolsChanged;
    // Local adapters are wireable synchronously, so they answer tools/list
    // before any downstream subprocess has finished spawning.
    this.installLocalRoutes();
    // A downstream that dies between discoveries would otherwise keep serving
    // routes from a process that no longer exists.
    for (const client of clients) {
      client.setCloseHandler(() => {
        this.discovered = false;
        void this.refresh().catch((error: unknown) =>
          log(
            "warn",
            `rediscovery after disconnect failed: ${errorMessage(error)}`,
          ),
        );
      });
    }
  }

  get discoveryState(): { discovered: boolean; discovering: boolean } {
    return {
      discovered: this.discovered,
      discovering: this.discovering !== undefined,
    };
  }

  /** Discovers every enabled downstream concurrently and rebuilds the route table. */
  async refresh(): Promise<void> {
    if (this.discovering) return this.discovering;
    const pending = this.discover().finally(() => {
      this.discovering = undefined;
    });
    this.discovering = pending;
    return pending;
  }

  /** Returns every tool with strict namespace prefixes applied. */
  async listTools(): Promise<Tool[]> {
    if (!this.discovered && !this.discovering) {
      const pending = this.refresh().catch((error: unknown) => {
        log("warn", `tool discovery failed: ${errorMessage(error)}`);
      });
      // A slow or hung downstream must not delay the local tool surface.
      await Promise.race([pending, delay(LIST_GRACE_MS)]);
    }
    return this.buildToolList();
  }

  async callTool(name: string, args: JsonObject): Promise<CallToolResult> {
    let route = this.routes.get(name);

    if (!route) {
      if (this.discovering) await this.discovering;
      else if (!this.discovered) await this.refresh();
      route = this.routes.get(name);

      if (!route) {
        // An explicitly requested namespace may be inside its reconnect
        // cooldown; one discovery retry lets it recover immediately.
        const prefix = name.split("_")[0] as Namespace;
        if (this.discoveryErrors.has(prefix)) {
          await this.refresh();
          route = this.routes.get(name);
        }
      }
    }

    if (!route) {
      return errorResult(
        `Unknown tool "${name}". Use the exact namespaced name returned by tools/list (for example think_sequentialthinking or context_compress).`,
        { namespaces: this.namespaceSummary() },
      );
    }

    if (route.kind === "local") {
      if (!route.local)
        return errorResult(`Local tool "${name}" is not wired.`);
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
    // Candidates are a preference list, so the newest route table must not be
    // allowed to decide which synonym wins.
    const lowered = candidates.map((candidate) => candidate.toLowerCase());
    for (const candidate of lowered) {
      for (const [exposed, route] of this.routes) {
        if (route.namespace !== namespace) continue;
        const remote =
          route.kind === "local" ? route.local?.name : route.remoteName;
        if (!remote) continue;
        const short = remote
          .replace(new RegExp(`^${namespace}_`), "")
          .toLowerCase();
        if (short === candidate || remote.toLowerCase() === candidate) {
          return exposed;
        }
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

  /**
   * Whether a route's oversized results may be replaced by a `ctx:` envelope.
   * Namespace policy decides first (retrieval and health payloads are the thing
   * being asked for, so they stay readable), then the route's own setting.
   */
  isCompressible(name: string): boolean {
    const route = this.routes.get(name);
    if (!route) return true;
    if (route.namespace && !NAMESPACE_INFO[route.namespace].compressible) {
      return false;
    }
    if (route.kind === "local") return route.local?.compressible !== false;
    return route.client?.compress !== false;
  }

  toolCount(namespace: Namespace): number {
    let count = 0;
    for (const route of this.routes.values()) {
      if (route.namespace !== namespace) continue;
      if (
        route.kind === "downstream" ||
        route.local?.name.startsWith(`${namespace}_`)
      ) {
        count += 1;
      }
    }
    return count;
  }

  namespaceSummary(): Record<
    string,
    { tools: number; enabled: boolean; error?: string }
  > {
    const summary: Record<
      string,
      { tools: number; enabled: boolean; error?: string }
    > = {};
    for (const namespace of NAMESPACES) {
      const error = this.discoveryErrors.get(namespace);
      // "Disabled" and "healthy but empty" used to look identical here.
      const enabled = this.clients.some(
        (client) => client.namespace === namespace && client.enabled,
      );
      summary[namespace] = {
        tools: this.toolCount(namespace),
        enabled,
        ...(error ? { error } : {}),
      };
    }
    return summary;
  }

  private async discover(): Promise<void> {
    const before = this.signature();
    const enabled = this.clients.filter((client) => client.enabled);
    const results = await Promise.allSettled(
      enabled.map((client) => client.listTools()),
    );

    this.routes.clear();
    this.installLocalRoutes();
    this.discoveryErrors.clear();

    results.forEach((result, index) => {
      const client = enabled[index];
      if (!client) return;
      if (result.status === "rejected") {
        const message = errorMessage(result.reason);
        this.discoveryErrors.set(client.namespace, message);
        log("warn", `downstream discovery failed: ${message}`);
        return;
      }
      // Local adapters win collisions so that context refs and pipeline
      // primitives cannot be shadowed by a downstream server.
      for (const tool of result.value) {
        const exposed = `${client.namespace}_${sanitizeToolName(
          tool.name.replace(new RegExp(`^${client.namespace}_`), ""),
        )}`;
        if (this.routes.has(exposed)) {
          log(
            "debug",
            `skipping duplicate tool ${exposed} from ${client.namespace}`,
          );
          continue;
        }
        this.routes.set(exposed, {
          kind: "downstream",
          namespace: client.namespace,
          client,
          remoteName: tool.name,
          remoteTool: tool,
        });
      }
    });

    this.discovered = true;
    if (this.signature() !== before) this.emitChanged();
  }

  private installLocalRoutes(): void {
    for (const tool of this.locals) {
      this.routes.set(tool.name, {
        kind: "local",
        namespace: namespaceOfTool(tool.name),
        local: tool,
      });
    }
  }

  /** Serves the current route table without touching any downstream. */
  private buildToolList(): Tool[] {
    const tools: Tool[] = [];
    for (const [name, route] of this.routes) {
      if (route.kind === "local" && route.local) {
        tools.push({
          name,
          description: route.local.description,
          inputSchema: route.local
            .inputSchema as unknown as Tool["inputSchema"],
        });
        continue;
      }
      if (route.kind !== "downstream" || !route.remoteTool) continue;
      tools.push({
        ...route.remoteTool,
        name,
        description: `[${route.namespace?.toUpperCase()}] ${
          route.remoteTool.description ??
          route.remoteTool.title ??
          route.remoteTool.name
        }`,
      });
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  private signature(): string {
    return [...this.routes.keys()].sort().join("\n");
  }

  private emitChanged(): void {
    if (!this.onToolsChanged) return;
    try {
      this.onToolsChanged();
    } catch (error) {
      log("warn", `tools/list_changed failed: ${errorMessage(error)}`);
    }
  }
}
