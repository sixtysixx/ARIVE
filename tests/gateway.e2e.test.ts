import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NAMESPACES } from "../src/core/config.js";

const projectRoot = path.resolve(import.meta.dir, "..");
const fakeDownstream = path.resolve(import.meta.dir, "fixtures/fake_downstream.ts");

let client: Client;
let transport: StdioClientTransport;
let tempDir: string;

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-e2e-"));
  const configPath = path.join(tempDir, "arive.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      compression: { thresholdTokens: 25 },
      memory: { dbPath: path.join(tempDir, "memory.db") },
      downstreams: NAMESPACES.map((namespace) => ({
        namespace,
        enabled: namespace === "lsp",
        command: "bun",
        ...(namespace === "lsp" ? { args: ["run", fakeDownstream] } : {}),
      })),
    }),
  );

  transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts", "--config", configPath],
    cwd: projectRoot,
    stderr: "pipe",
  });
  client = new Client({ name: "arive-e2e", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("gateway end to end", () => {
  test("lists namespaced local and composite tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const expected of [
      "context_compress",
      "context_retrieve",
      "search_query",
      "mem_remember",
      "arive_reasoned_debug",
      "arive_status",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).toContain("lsp_echo");
    expect(names.every((name) => !name.startsWith("think_"))).toBe(true);
  });

  test("routes a namespaced call to a real subprocess server", async () => {
    const result = await client.callTool({
      name: "lsp_echo",
      arguments: { text: "through-the-gateway" },
    });
    const payload = JSON.parse(textOf(result)) as { echo: string; from: string };
    expect(payload.echo).toBe("through-the-gateway");
    expect(payload.from).toBe("fake-downstream");
  }, 20_000);

  test("compresses and retrieves a payload losslessly", async () => {
    const original = "gateway payload ".repeat(80);
    const compressed = await client.callTool({
      name: "context_compress",
      arguments: { content: original, force: true },
    });
    const envelope = JSON.parse(textOf(compressed)) as {
      compressed: boolean;
      ref: string;
    };
    expect(envelope.compressed).toBe(true);
    expect(envelope.ref.startsWith("ctx:")).toBe(true);

    const retrieved = await client.callTool({
      name: "context_retrieve",
      arguments: { ref: envelope.ref },
    });
    const payload = JSON.parse(textOf(retrieved)) as { content: string };
    expect(payload.content).toBe(original);
  });

  test("compresses oversized tool output behind a retrievable ref", async () => {
    const result = await client.callTool({
      name: "search_files",
      arguments: { path: "src", maxResults: 20 },
    });
    const envelope = JSON.parse(textOf(result)) as {
      _arive_compressed: boolean;
      ref: string;
      originalChars: number;
    };
    expect(envelope._arive_compressed).toBe(true);
    expect(envelope.originalChars).toBeGreaterThan(100);

    const retrieved = await client.callTool({
      name: "context_retrieve",
      arguments: { ref: envelope.ref },
    });
    const payload = JSON.parse(textOf(retrieved)) as { content: string };
    const original = JSON.parse(payload.content) as { files: string[] };
    expect(original.files.length).toBeGreaterThan(3);
  });

  test("reports namespace health", async () => {
    const status = await client.callTool({ name: "arive_status", arguments: {} });
    const payload = JSON.parse(textOf(status)) as {
      namespaces: Record<string, { tools: number }>;
      downstreams: Array<{ namespace: string; enabled: boolean }>;
    };
    expect(Object.keys(payload.namespaces).sort()).toEqual([...NAMESPACES].sort());
    expect(payload.namespaces.context?.tools).toBeGreaterThanOrEqual(3);
    expect(payload.downstreams.find((entry) => entry.namespace === "lsp")?.enabled).toBe(true);
    expect(payload.downstreams.filter((entry) => entry.enabled)).toHaveLength(1);
  });

  test("returns a structured error for unknown tools", async () => {
    const result = await client.callTool({ name: "nope_missing", arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain("Unknown tool");
  });
});
