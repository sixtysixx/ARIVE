import { afterAll, describe, expect, test } from "bun:test";
import * as path from "path";
import type { DownstreamConfig } from "../src/core/config.js";
import { DownstreamClient } from "../src/core/mcp-client.js";
import { ToolRegistry } from "../src/core/registry.js";

const fixture = path.resolve(import.meta.dir, "fixtures/fake_downstream.ts");

const config: DownstreamConfig = {
  namespace: "lsp",
  enabled: true,
  command: "bun",
  args: ["run", fixture],
  env: {},
  connectTimeoutMs: 15_000,
  callTimeoutMs: 15_000,
  compress: true,
};

const client = new DownstreamClient(config);

afterAll(async () => {
  await client.close();
});

describe("downstream multiplexing", () => {
  test("connects to a real stdio server and lists its tools", async () => {
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
    expect(client.status().connected).toBe(true);
    expect(client.status().toolCount).toBe(1);
  }, 20_000);

  test("aggregates and routes through the namespaced registry", async () => {
    const registry = new ToolRegistry([client], []);
    const tools = await registry.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("lsp_echo");

    const result = await registry.callTool("lsp_echo", { text: "ping" });
    const block = result.content[0];
    if (block.type !== "text") throw new Error("expected text block");
    const payload = JSON.parse(block.text) as { echo: string; from: string };
    expect(payload.echo).toBe("ping");
    expect(payload.from).toBe("fake-downstream");
  }, 20_000);
});
