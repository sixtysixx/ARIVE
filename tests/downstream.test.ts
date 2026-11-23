import { afterAll, describe, expect, test } from "bun:test";
import * as path from "path";
import type { DownstreamConfig } from "../src/core/config.js";
import { DownstreamClient } from "../src/core/mcp-client.js";
import { errorMessage } from "../src/core/log.js";
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
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "die", "wait"]);
    expect(client.status().connected).toBe(true);
    expect(client.status().toolCount).toBe(3);
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

  test("close() during startup keeps the client closed", async () => {
    const late = new DownstreamClient(config);
    const pending = late.listTools();
    await late.close();
    await expect(pending).rejects.toThrow("was closed during startup");

    const status = late.status();
    expect(status.connected).toBe(false);
    expect(status.toolCount).toBe(0);
    expect(status.error).toBeUndefined();
    expect(status.retryInMs).toBeUndefined();
  }, 20_000);

  test("reports a tools/list failure while still connected", async () => {
    const late = new DownstreamClient({ ...config, env: { FAKE_LIST_FAIL: "1" } });
    await expect(late.listTools()).rejects.toThrow(/list failed/);

    const status = late.status();
    expect(status.connected).toBe(true);
    expect(String(status.error)).toContain("list failed");
    await late.close();
  }, 20_000);

  test("does not resurrect a closed client", async () => {
    const scoped = new DownstreamClient(config);
    await scoped.listTools();
    await scoped.close();
    expect(scoped.status().closed).toBe(true);
    expect(scoped.status().connected).toBe(false);
    await expect(scoped.listTools()).rejects.toThrow(/was closed/);
  }, 20_000);

  // Declared last: it leaves its child dead.
  test("concurrent calls survive a downstream crash without a spurious startup error", async () => {
    // The child dies 50ms after answering `die`, while both `wait` calls are
    // still in flight, so they reject in the same tick.
    const crashy = new DownstreamClient({
      ...config,
      env: { FAKE_DIE_MS: "50" },
    });
    // A repair is a teardown plus a connect. One burst must produce one
    // repair: a second teardown would bump `generation` and abort the
    // handshake the other call is waiting on. Teardown is internal, so count
    // it through the runtime object rather than the terminal close().
    let repairs = 0;
    const internals = crashy as unknown as { teardown: () => Promise<void> };
    const teardownOnce = internals.teardown.bind(crashy);
    internals.teardown = async () => {
      repairs += 1;
      return teardownOnce();
    };
    try {
      await crashy.callTool("die", {});

      const results = await Promise.allSettled([
        crashy.callTool("wait", {}),
        crashy.callTool("wait", {}),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          expect(errorMessage(result.reason)).not.toContain(
            "was closed during startup",
          );
        }
      }
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
      expect(repairs).toBe(1);

      const later = await crashy.callTool("echo", { text: "c" });
      const block = later.content[0];
      if (block.type !== "text") throw new Error("expected text block");
      expect(JSON.parse(block.text)).toMatchObject({ echo: "c" });
    } finally {
      await crashy.close();
    }
  }, 30_000);
});
