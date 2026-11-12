import { describe, expect, test } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Namespace } from "../src/core/config.js";
import type { DownstreamClient } from "../src/core/mcp-client.js";
import { sanitizeToolName, ToolRegistry } from "../src/core/registry.js";
import type { LocalTool } from "../src/core/results.js";

function remoteTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {} },
  };
}

function fakeClient(
  namespace: Namespace,
  tools: Tool[],
  enabled = true,
): DownstreamClient {
  return {
    namespace,
    enabled,
    compress: true,
    listTools: async () => tools,
    callTool: async (name: string) => ({
      content: [{ type: "text" as const, text: `remote:${namespace}/${name}` }],
    }),
    status: () => ({
      namespace,
      enabled,
      connected: true,
      toolCount: tools.length,
      command: "fake",
    }),
    close: async () => {},
    setCloseHandler: () => {},
  } as unknown as DownstreamClient;
}

function localTool(name: string): LocalTool {
  return {
    name,
    description: "local",
    inputSchema: { type: "object", properties: {} },
    handler: () => ({ content: [{ type: "text", text: `local:${name}` }] }),
  };
}

describe("ToolRegistry", () => {
  test("prefixes downstream tools and keeps local adapters", async () => {
    const registry = new ToolRegistry(
      [fakeClient("search", [remoteTool("query"), remoteTool("files")])],
      [localTool("context_retrieve")],
    );
    await registry.refresh();
    const tools = await registry.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_query");
    expect(names).toContain("search_files");
    expect(names).toContain("context_retrieve");
    expect(names).not.toContain("query");
  });

  test("local adapters win name collisions", async () => {
    const registry = new ToolRegistry(
      [fakeClient("context", [remoteTool("retrieve")])],
      [localTool("context_retrieve")],
    );
    await registry.refresh();
    const tools = await registry.listTools();
    expect(tools.filter((t) => t.name === "context_retrieve")).toHaveLength(1);
    const result = await registry.callTool("context_retrieve", {});
    expect(JSON.stringify(result.content)).toContain("local:context_retrieve");
  });

  test("routes namespaced calls to the owning client", async () => {
    const registry = new ToolRegistry(
      [fakeClient("lsp", [remoteTool("diagnostics")])],
      [],
    );
    await registry.refresh();
    const result = await registry.callTool("lsp_diagnostics", { file: "a.ts" });
    expect(JSON.stringify(result.content)).toBe(
      JSON.stringify([{ type: "text", text: "remote:lsp/diagnostics" }]),
    );
  });

  test("returns an actionable error for unknown tools", async () => {
    const registry = new ToolRegistry(
      [fakeClient("think", [remoteTool("think")])],
      [],
    );
    await registry.refresh();
    const result = await registry.callTool("think_missing", {});
    expect(result.isError).toBe(true);
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text");
    expect(text.text).toContain("Unknown tool");
  });

  test("discovers tools by candidate names and suffix", async () => {
    const registry = new ToolRegistry(
      [
        fakeClient("lsp", [
          remoteTool("rust_analyzer_diagnostics"),
          remoteTool("speculative_edit"),
        ]),
      ],
      [],
    );
    await registry.refresh();
    expect(registry.findTool("lsp", ["diagnostics"])).toBe(
      "lsp_rust_analyzer_diagnostics",
    );
    expect(registry.findTool("lsp", ["speculative_edit"])).toBe(
      "lsp_speculative_edit",
    );
    expect(registry.findTool("lsp", ["nope"])).toBeUndefined();
  });

  test("resolves capabilities in the caller's preference order", async () => {
    // The downstream lists `attach` first; the caller prefers `launch`.
    const registry = new ToolRegistry(
      [fakeClient("dap", [remoteTool("attach"), remoteTool("launch")])],
      [],
    );
    await registry.refresh();
    expect(registry.findTool("dap", ["launch", "attach"])).toBe("dap_launch");
    // Order is still exact-match only: a missing preferred name falls through.
    expect(registry.findTool("dap", ["start", "attach"])).toBe("dap_attach");
  });

  test("counts only real namespace tools", async () => {
    const registry = new ToolRegistry(
      [fakeClient("dap", [remoteTool("launch")])],
      [localTool("arive_status"), localTool("context_stats")],
    );
    await registry.refresh();
    expect(registry.toolCount("dap")).toBe(1);
    expect(registry.toolCount("context")).toBe(1);
    expect(registry.toolCount("mem")).toBe(0);
  });

  test("serves local tools without waiting for a hung downstream", async () => {
    const hanging = {
      ...fakeClient("think", []),
      listTools: () => new Promise<Tool[]>(() => {}),
    } as unknown as DownstreamClient;
    const registry = new ToolRegistry([hanging], [localTool("arive_status")]);

    const started = Date.now();
    const tools = await registry.listTools();
    const elapsed = Date.now() - started;

    expect(tools.map((tool) => tool.name)).toEqual(["arive_status"]);
    expect(elapsed).toBeLessThan(2_000);
    expect(registry.discoveryState.discovering).toBe(true);
  });

  test("announces a changed tool list only when the route table changes", async () => {
    let changes = 0;
    const registry = new ToolRegistry(
      [fakeClient("search", [remoteTool("query")])],
      [localTool("arive_status")],
      () => {
        changes += 1;
      },
    );

    expect(changes).toBe(0);
    await registry.refresh();
    expect(changes).toBe(1);
    await registry.refresh();
    expect(changes).toBe(1);
  });

  test("non-namespaced local tools belong to no namespace", async () => {
    const registry = new ToolRegistry([], [localTool("arive_status")]);
    await registry.refresh();
    expect(registry.findTool("context", ["status"])).toBeUndefined();
    expect(registry.toolCount("context")).toBe(0);
  });

  test("retries discovery once for an explicitly called namespace", async () => {
    let attempts = 0;
    const flaky = {
      ...fakeClient("lsp", []),
      listTools: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Failed to start downstream "lsp"');
        return [remoteTool("echo")];
      },
    } as unknown as DownstreamClient;
    const registry = new ToolRegistry([flaky], []);

    const result = await registry.callTool("lsp_echo", { text: "ping" });
    expect(attempts).toBe(2);
    expect(JSON.stringify(result.content)).toContain("remote:lsp/echo");
  });

  test("drops routes when a downstream transport closes", async () => {
    let onClose: (() => void) | undefined;
    let alive = true;
    const flaky = {
      ...fakeClient("lsp", []),
      listTools: async () => {
        if (!alive) throw new Error('downstream "lsp" transport closed');
        return [remoteTool("echo")];
      },
      setCloseHandler: (handler: () => void) => {
        onClose = handler;
      },
    } as unknown as DownstreamClient;
    const registry = new ToolRegistry([flaky], []);

    const before = (await registry.listTools()).map((tool) => tool.name);
    expect(before).toContain("lsp_echo");

    alive = false;
    if (!onClose) throw new Error("registry did not register a close handler");
    onClose();
    await registry.refresh();

    const after = (await registry.listTools()).map((tool) => tool.name);
    expect(after).not.toContain("lsp_echo");
    expect(registry.namespaceSummary().lsp).toEqual({
      tools: 0,
      enabled: true,
      error: 'downstream "lsp" transport closed',
    });
  });

  test("reports disabled namespaces distinctly from empty ones", async () => {
    const registry = new ToolRegistry(
      [fakeClient("dap", [remoteTool("launch")], false)],
      [],
    );
    await registry.refresh();
    expect(registry.namespaceSummary().dap).toEqual({
      tools: 0,
      enabled: false,
    });
  });

  test("sanitizes invalid tool name characters", () => {
    expect(sanitizeToolName("do/thing.v2")).toBe("do_thing_v2");
  });
});
