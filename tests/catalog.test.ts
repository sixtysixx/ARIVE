import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  buildInstructions,
  NAMESPACE_INFO,
  namespaceOfTool,
} from "../src/core/catalog.js";
import { defaultConfig, NAMESPACES, type Namespace } from "../src/core/config.js";
import type { DownstreamClient } from "../src/core/mcp-client.js";
import { ToolRegistry } from "../src/core/registry.js";
import type { LocalTool } from "../src/core/results.js";

function localTool(name: string, compressible?: boolean): LocalTool {
  return {
    name,
    description: "local",
    inputSchema: { type: "object", properties: {} },
    handler: () => ({ content: [{ type: "text", text: `local:${name}` }] }),
    ...(compressible === undefined ? {} : { compressible }),
  };
}

function fakeClient(namespace: Namespace, compress: boolean): DownstreamClient {
  const tools: Tool[] = [
    {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: {} },
    },
  ];
  return {
    namespace,
    enabled: true,
    compress,
    listTools: async () => tools,
    callTool: async () => ({ content: [{ type: "text", text: "remote" }] }),
    status: () => ({
      namespace,
      enabled: true,
      connected: true,
      toolCount: tools.length,
      command: "fake",
    }),
    close: async () => {},
    setCloseHandler: () => {},
  } as unknown as DownstreamClient;
}

describe("namespace catalogue", () => {
  test("covers every namespace in declaration order", () => {
    expect(Object.keys(NAMESPACE_INFO)).toEqual([...NAMESPACES]);
  });

  test("resolves a tool's namespace by prefix only", () => {
    expect(namespaceOfTool("search_query")).toBe("search");
    expect(namespaceOfTool("context_retrieve")).toBe("context");
    expect(namespaceOfTool("arive_status")).toBeUndefined();
    expect(namespaceOfTool("no_underscore_here")).toBeUndefined();
  });

  test("instructions name every namespace and the retrieval path", () => {
    const instructions = buildInstructions(defaultConfig().hooks);
    for (const prefix of NAMESPACES) {
      expect(instructions).toContain(`${prefix}_*`);
    }
    expect(instructions).toContain("context_retrieve");
    expect(instructions).toContain("arive_status");
    // Without rules there is nothing to enforce, so the contract stays out.
    expect(instructions).not.toContain("Guard rules");
    expect(instructions).not.toContain("arive_guard");
  });

  test("instructions advertise configured guard rules", () => {
    const config = defaultConfig();
    config.hooks.guards = [
      {
        id: "no-rm",
        scope: "args",
        condition: "rm\\s+-rf",
        action: "block",
        guidance: "Never delete recursively.",
      },
    ];
    const instructions = buildInstructions(config.hooks);
    expect(instructions).toContain("no-rm (args)");
    expect(instructions).toContain("arive_guard");

    config.hooks.enabled = false;
    expect(buildInstructions(config.hooks)).not.toContain("Guard rules");
  });

  test("compression policy follows the catalogue and the route", async () => {
    const registry = new ToolRegistry(
      [fakeClient("lsp", false)],
      [
        localTool("search_query"),
        localTool("context_retrieve"),
        localTool("rag_query"),
        localTool("lh_run_status"),
        localTool("fable_judge"),
        localTool("arive_status", false),
      ],
    );
    await registry.refresh();

    // Retrieval and health payloads are the answer, not noise.
    expect(registry.isCompressible("context_retrieve")).toBe(false);
    expect(registry.isCompressible("rag_query")).toBe(false);
    expect(registry.isCompressible("arive_status")).toBe(false);
    // A run status and a judge verdict are answers too.
    expect(registry.isCompressible("lh_run_status")).toBe(false);
    expect(registry.isCompressible("fable_judge")).toBe(false);
    // Search results are noise-sized; a downstream can still opt out.
    expect(registry.isCompressible("search_query")).toBe(true);
    expect(registry.isCompressible("lsp_echo")).toBe(false);
    // An unrouted name is not a reason to skip compression.
    expect(registry.isCompressible("nope_missing")).toBe(true);
  });

  test("README namespace table matches the catalogue", () => {
    // The table is a rendered copy of NAMESPACE_INFO. This assertion is what
    // stops it from becoming a fourth divergent variant of the same list.
    const readme = fs.readFileSync(
      path.resolve(import.meta.dir, "../README.md"),
      "utf8",
    );
    const listed = [...readme.matchAll(/^\| `([a-z]+)_\*`/gm)].map(
      (match) => match[1]!,
    );
    expect(listed.sort()).toEqual([...NAMESPACES].sort());
  });
});
