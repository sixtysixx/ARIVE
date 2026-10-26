import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamConfig, Namespace } from "./config.js";
import { errorMessage, log } from "./log.js";
import { type JsonObject, withTimeout } from "./results.js";

export interface ClientStatus {
  namespace: Namespace;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  error?: string;
  command: string;
}

const RECONNECT_PATTERN =
  /closed|not connected|disconnect|transport|EPIPE|ECONNRESET|broken pipe/i;

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
  private connecting?: Promise<void>;

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

  status(): ClientStatus {
    return {
      namespace: this.namespace,
      enabled: this.config.enabled,
      connected: this.client !== undefined,
      toolCount: this.tools?.length ?? 0,
      ...(this.lastError ? { error: this.lastError } : {}),
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

    const client = this.requireClient();
    const result = await withTimeout(
      client.listTools(),
      this.config.connectTimeoutMs,
      `${this.namespace} tools/list`,
    );
    this.tools = result.tools;
    return this.tools;
  }

  async callTool(tool: string, args: JsonObject): Promise<CallToolResult> {
    await this.connect();
    try {
      return await this.invoke(tool, args);
    } catch (error) {
      if (!RECONNECT_PATTERN.test(errorMessage(error))) throw error;
      log("warn", `${this.namespace}: transport error, reconnecting once`, {
        error: errorMessage(error),
      });
      await this.close();
      await this.connect();
      return this.invoke(tool, args);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
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
    const result = await withTimeout(
      client.callTool({ name: tool, arguments: args }),
      this.config.callTimeoutMs,
      `${this.namespace}/${tool}`,
    );
    return result as CallToolResult;
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error(`Namespace "${this.namespace}" is not connected.`);
    }
    return this.client;
  }

  private async connect(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error(
        `Namespace "${this.namespace}" is disabled in configuration.`,
      );
    }
    if (this.client) return;
    if (this.connecting) return this.connecting;

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
        { name: "arive-gateway", version: "1.0.0" },
        { capabilities: {} },
      );

      try {
        await withTimeout(
          client.connect(transport),
          this.config.connectTimeoutMs,
          `${this.namespace} connect`,
        );
        this.client = client;
        this.lastError = undefined;
        log("info", `${this.namespace}: downstream connected`, {
          command: [this.config.command, ...this.config.args].join(" "),
        });
      } catch (error) {
        this.lastError = errorMessage(error);
        try {
          await client.close();
        } catch {
          // Ignore cleanup failures on a failed handshake.
        }
        throw new Error(
          `Failed to start downstream "${this.namespace}" (${this.config.command} ${this.config.args.join(" ")}): ${this.lastError}`,
        );
      }
    })().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }
}
