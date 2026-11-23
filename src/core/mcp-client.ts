import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ErrorCode,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamConfig, Namespace } from "./config.js";
import { errorMessage, log } from "./log.js";
import type { JsonObject } from "./results.js";
import { VERSION } from "./version.js";

export interface ClientStatus {
  namespace: Namespace;
  enabled: boolean;
  connected: boolean;
  closed: boolean;
  toolCount: number;
  error?: string;
  /** Milliseconds until the next automatic reconnect attempt is allowed. */
  retryInMs?: number;
  command: string;
}

const RECONNECT_PATTERN =
  /closed|not connected|disconnect|transport|EPIPE|ECONNRESET|broken pipe/i;

/** How long a failed downstream is left alone before an automatic retry. */
const RETRY_COOLDOWN_MS = 30_000;

function isTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * A lazily started downstream MCP server. A failed server never takes down the
 * gateway: callers get an actionable error and the rest of the namespaces work.
 */
export class DownstreamClient {
  readonly namespace: Namespace;
  private readonly config: DownstreamConfig;
  private client?: Client;
  private tools?: Tool[];
  private lastError?: string;
  private retryAt = 0;
  private connecting?: Promise<void>;
  /** Shared repair for concurrent transport failures. */
  private reconnecting?: Promise<void>;
  /** Bumped by `close()` so an in-flight connect cannot resurrect the client. */
  private generation = 0;
  /** Terminal: a closed client never spawns again, unlike a transport repair. */
  private closed = false;
  private closeHandler?: () => void;

  constructor(config: DownstreamConfig) {
    this.config = config;
    this.namespace = config.namespace;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get compress(): boolean {
    return this.config.compress;
  }

  /** Registered by the registry so a dead downstream invalidates its routes. */
  setCloseHandler(handler: () => void): void {
    this.closeHandler = handler;
  }

  status(): ClientStatus {
    return {
      namespace: this.namespace,
      enabled: this.config.enabled,
      connected: this.client !== undefined,
      closed: this.closed,
      toolCount: this.tools?.length ?? 0,
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.retryAt > Date.now()
        ? { retryInMs: this.retryAt - Date.now() }
        : {}),
      command: [this.config.command, ...this.config.args].join(" "),
    };
  }

  async listTools(force = false): Promise<Tool[]> {
    if (!this.config.enabled) {
      throw new Error(
        `Namespace "${this.namespace}" is disabled in configuration.`,
      );
    }
    await this.connect();
    if (this.tools && !force) return this.tools;
    const generation = this.generation;

    const client = this.requireClient();
    try {
      const result = await client.listTools(undefined, {
        timeout: this.config.connectTimeoutMs,
      });
      if (generation !== this.generation) {
        throw new Error(
          `Namespace "${this.namespace}" was closed during tools/list.`,
        );
      }
      this.tools = result.tools;
      this.lastError = undefined;
      return this.tools;
    } catch (error) {
      const message = isTimeout(error)
        ? `${this.namespace} tools/list timed out after ${this.config.connectTimeoutMs}ms`
        : errorMessage(error);
      // Discovery failed while the transport is alive: status must say so
      // instead of reporting a healthy downstream with zero tools.
      this.lastError = message;
      if (isTimeout(error)) throw new Error(message);
      throw error;
    }
  }

  async callTool(tool: string, args: JsonObject): Promise<CallToolResult> {
    // An explicit call is user intent, so it bypasses the reconnect cooldown.
    await this.connect(false);
    try {
      return await this.invoke(tool, args);
    } catch (error) {
      if (!RECONNECT_PATTERN.test(errorMessage(error))) throw error;
      log("warn", `${this.namespace}: transport error, reconnecting once`, {
        error: errorMessage(error),
      });
      await this.reconnect();
      return this.invoke(tool, args);
    }
  }

  /**
   * Concurrent transport failures share one repair, so no call closes another
   * call's handshake. One transport close rejects every pending request in the
   * same tick; without this, each of them would bump `generation` and abort the
   * single reconnect the others are waiting on.
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      this.lastError = undefined;
      this.retryAt = 0;
      await this.teardown();
      await this.connect(false);
    })().finally(() => {
      this.reconnecting = undefined;
    });
    return this.reconnecting;
  }

  /** Terminal: after this, any call fails instead of respawning the child. */
  async close(): Promise<void> {
    this.closed = true;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    // Increment first: any connect() awaiting a handshake must observe the
    // close and refuse to install its client afterwards.
    this.generation += 1;
    const client = this.client;
    this.client = undefined;
    this.tools = undefined;
    this.lastError = undefined;
    this.retryAt = 0;
    if (client) {
      try {
        await client.close();
      } catch {
        // A dead child process is already closed enough.
      }
    }
  }

  private async invoke(
    tool: string,
    args: JsonObject,
  ): Promise<CallToolResult> {
    const client = this.requireClient();
    try {
      const result = await client.callTool(
        { name: tool, arguments: args },
        undefined,
        { timeout: this.config.callTimeoutMs },
      );
      return result as CallToolResult;
    } catch (error) {
      // A timed-out request is cancelled by the SDK, so report it as such
      // instead of letting it look like a transport failure.
      if (isTimeout(error)) {
        throw new Error(
          `${this.namespace}/${tool} timed out after ${this.config.callTimeoutMs}ms`,
        );
      }
      throw error;
    }
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error(`Namespace "${this.namespace}" is not connected.`);
    }
    return this.client;
  }

  private async connect(respectCooldown = true): Promise<void> {
    if (!this.config.enabled) {
      throw new Error(
        `Namespace "${this.namespace}" is disabled in configuration.`,
      );
    }
    if (this.closed) {
      throw new Error(`Namespace "${this.namespace}" was closed.`);
    }
    if (this.client) return;
    if (this.connecting) return this.connecting;
    if (respectCooldown && this.lastError && this.retryAt > Date.now()) {
      throw new Error(this.lastError);
    }
    const generation = this.generation;

    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: { ...getDefaultEnvironment(), ...this.config.env },
        ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
        stderr: "pipe",
      });

      transport.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString("utf8").trimEnd();
        if (line) log("debug", `[${this.namespace}] ${line}`);
      });

      const client = new Client(
        { name: "arive-gateway", version: VERSION },
        { capabilities: {} },
      );

      // A crashed child must not leave a stale client behind: drop it and hold
      // off the next automatic spawn for the cooldown window.
      transport.onclose = () => {
        if (this.client !== client) return;
        this.client = undefined;
        this.tools = undefined;
        this.lastError = `downstream "${this.namespace}" transport closed`;
        this.retryAt = Date.now() + RETRY_COOLDOWN_MS;
        log("warn", `${this.namespace}: downstream transport closed`);
        this.closeHandler?.();
      };

      try {
        await client.connect(transport, {
          timeout: this.config.connectTimeoutMs,
        });
      } catch (error) {
        const message = `Failed to start downstream "${this.namespace}" (${this.config.command} ${this.config.args.join(" ")}): ${errorMessage(error)}`;
        this.lastError = message;
        this.retryAt = Date.now() + RETRY_COOLDOWN_MS;
        try {
          await client.close();
        } catch {
          // Ignore cleanup failures on a failed handshake.
        }
        throw new Error(message);
      }

      // `close()` ran while the handshake was in flight: honour it instead of
      // installing a client the caller already believes is gone. This is a
      // deliberate shutdown, not a failure, so it sets no cooldown.
      if (generation !== this.generation) {
        try {
          await client.close();
        } catch {
          // The gateway is shutting down; a half-open child is already gone.
        }
        throw new Error(
          `Namespace "${this.namespace}" was closed during startup.`,
        );
      }

      this.client = client;
      this.lastError = undefined;
      this.retryAt = 0;
      log("info", `${this.namespace}: downstream connected`, {
        command: [this.config.command, ...this.config.args].join(" "),
      });
    })().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }
}
