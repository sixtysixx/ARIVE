import { afterAll, describe, expect, test } from "bun:test";
import * as os from "os";
import * as path from "path";
import type { DownstreamConfig } from "../src/core/config.js";
import { DownstreamClient } from "../src/core/mcp-client.js";

const slowFixture = path.resolve(
  import.meta.dir,
  "fixtures/slow_downstream.ts",
);

function config(overrides: Partial<DownstreamConfig>): DownstreamConfig {
  return {
    namespace: "think",
    enabled: true,
    command: "bun",
    args: ["run", slowFixture],
    env: {},
    connectTimeoutMs: 15_000,
    callTimeoutMs: 15_000,
    compress: true,
    ...overrides,
  };
}

const slow = new DownstreamClient(
  config({ namespace: "think", callTimeoutMs: 300 }),
);
const missing = new DownstreamClient(
  config({
    namespace: "dap",
    command: path.join(os.tmpdir(), "arive-definitely-missing-binary"),
    args: [],
  }),
);

afterAll(async () => {
  await slow.close();
  await missing.close();
});

describe("downstream request limits", () => {
  test("cancels a call that exceeds callTimeoutMs", async () => {
    const started = Date.now();
    await expect(slow.callTool("wait", {})).rejects.toThrow(
      /timed out after 300ms/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  test("fails fast while a failed downstream is cooling down", async () => {
    await expect(missing.listTools()).rejects.toThrow(
      /Failed to start downstream/,
    );
    const started = Date.now();
    await expect(missing.listTools()).rejects.toThrow(
      /Failed to start downstream/,
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(missing.status().retryInMs ?? 0).toBeGreaterThan(0);
  }, 20_000);
});
