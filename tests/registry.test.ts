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
    await registry.listTools();
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
    await registry.listTools();
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
    await registry.listTools();
    expect(registry.findTool("lsp", ["diagnostics"])).toBe(
      "lsp_rust_analyzer_diagnostics",
    );
    expect(registry.findTool("lsp", ["speculative_edit"])).toBe(
      "lsp_speculative_edit",
    );
    expect(registry.findTool("lsp", ["nope"])).toBeUndefined();
  });

  test("counts only real namespace tools", async () => {
    const registry = new ToolRegistry(
      [fakeClient("dap", [remoteTool("launch")])],
      [localTool("arive_status"), localTool("context_stats")],
    );
    await registry.listTools();
    expect(registry.toolCount("dap")).toBe(1);
    expect(registry.toolCount("context")).toBe(1);
    expect(registry.toolCount("mem")).toBe(0);
  });

  test("sanitizes invalid tool name characters", () => {
    expect(sanitizeToolName("do/thing.v2")).toBe("do_thing_v2");
  });
});
