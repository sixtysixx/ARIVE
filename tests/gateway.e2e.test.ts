import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NAMESPACES } from "../src/core/config.js";

const projectRoot = path.resolve(import.meta.dir, "..");
const fakeDownstream = path.resolve(
  import.meta.dir,
  "fixtures/fake_downstream.ts",
);
const fakeLh = path.resolve(import.meta.dir, "fixtures/fake_lh.ts");

let client: Client;
let transport: StdioClientTransport;
let tempDir: string;
let toolListChanges = 0;

async function waitForTool(name: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { tools } = await client.listTools();
    if (tools.some((tool) => tool.name === name)) return true;
    await Bun.sleep(100);
  }
  return false;
}

async function waitForNotification(timeoutMs = 2_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && toolListChanges === 0) {
    await Bun.sleep(50);
  }
  return toolListChanges;
}

function textOf(result: unknown): string {
  const content = (
    result as { content: Array<{ type: string; text?: string }> }
  ).content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-e2e-"));
  const configPath = path.join(tempDir, "arive.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      compression: { thresholdTokens: 25 },
      memory: { dbPath: path.join(tempDir, "memory.db") },
      rag: { dbPath: path.join(tempDir, "rag.db") },
      downstreams: NAMESPACES.filter((namespace) => namespace !== "fable").map(
        (namespace) => ({
          namespace,
          enabled: namespace === "lsp" || namespace === "lh",
          command: "bun",
          args: [
            "run",
            namespace === "lh" ? fakeLh : fakeDownstream,
          ],
        }),
      ),
      hooks: {
        // The default docs would append text blocks and break JSON parsing.
        docs: [],
        guards: [
          {
            id: "no-credential-scan",
            // "both" so the same rule is visible to a call check and to
            // arive_guard, which is how a client validates generated text.
            scope: "both",
            tool: "^search_",
            action: "block",
            condition: "AKIA[0-9A-Z]{16}",
            guidance:
              "Never scan for literal credentials; reference secrets by name.",
          },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(tempDir, "corpus.ts"),
    [
      "export function compressPayloadGateway() {",
      '  return "corpus payload for the retrieval index";',
      "}",
      "",
      'export const CORPUS_IDENTIFIER = "gatewayRetrievalProof";',
      "",
    ].join("\n"),
  );

  transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts", "--config", configPath],
    cwd: projectRoot,
    stderr: "pipe",
  });
  client = new Client(
    { name: "arive-e2e", version: "1.0.0" },
    { capabilities: {} },
  );
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    toolListChanges += 1;
  });
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
      "arive_guard",
      "arive_capabilities",
      "context_compress",
      "context_retrieve",
      "search_query",
      "mem_remember",
      "rag_index",
      "rag_query",
      "rag_stats",
      "arive_reasoned_debug",
      "arive_status",
      "fable_method",
      "fable_plan",
      "fable_judge",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names.every((name) => !name.startsWith("think_"))).toBe(true);

    expect(await waitForTool("lsp_echo")).toBe(true);
    // The downstream names its tools lh_* already; the gateway must not
    // prefix them twice.
    expect(await waitForTool("lh_start_run")).toBe(true);
    expect(names).not.toContain("lh_lh_start_run");
    expect(await waitForNotification()).toBeGreaterThan(0);
  }, 20_000);

  test("drives a long-horizon run through its namespace", async () => {
    const result = await client.callTool({
      name: "lh_start_run",
      arguments: { workspace: projectRoot },
    });
    const payload = JSON.parse(textOf(result)) as {
      success: boolean;
      run_id: string;
    };
    expect(payload.success).toBe(true);
    expect(payload.run_id).toBe("run-1");
  }, 20_000);

  test("builds a fable plan artifact", async () => {
    const result = await client.callTool({
      name: "fable_plan",
      arguments: {
        classification: "task",
        task: "bump the cache header",
        done: "clients see max-age=60",
        verification: "curl -sI shows max-age=60",
        recommendation: "set it in the CDN config",
      },
    });
    const plan = JSON.parse(textOf(result)) as {
      ok: boolean;
      artifact: string;
    };
    expect(plan.ok).toBe(true);
    expect(plan.artifact).toContain("## Checklist");
  }, 20_000);

  test("routes jobs through arive_capabilities", async () => {
    const result = await client.callTool({
      name: "arive_capabilities",
      arguments: {},
    });
    const payload = JSON.parse(textOf(result)) as {
      instructions: string;
      capabilities: Array<{ tool: string }>;
      namespaces: Record<string, { usable: boolean }>;
    };
    expect(payload.instructions).toContain("Route by job");
    const tools = payload.capabilities.map((entry) => entry.tool);
    expect(tools).toContain("fable_judge");
    expect(tools).toContain("lh_start_run");
    // Both new namespaces are live: one in-process, one over stdio.
    expect(payload.namespaces.fable?.usable).toBe(true);
    expect(payload.namespaces.lh?.usable).toBe(true);
  }, 20_000);

  test("blocks a tool call before it executes", async () => {
    const result = await client.callTool({
      name: "search_query",
      arguments: { pattern: "AKIAABCDEFGHIJKLMNOP" },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const body = textOf(result);
    expect(body).toContain("no-credential-scan");
    expect(body).toContain('"executed": false');
    expect(body).toContain("<system-reminder>");
    expect(body).toContain("reference secrets by name");
  }, 20_000);

  test("arive_guard returns abort guidance for text", async () => {
    const result = await client.callTool({
      name: "arive_guard",
      arguments: { text: "const key = 'AKIAABCDEFGHIJKLMNOP'" },
    });
    const payload = JSON.parse(textOf(result)) as {
      blocked: boolean;
      abort: boolean;
      reminder?: string;
    };
    expect(payload.blocked).toBe(true);
    expect(payload.abort).toBe(true);
    expect(payload.reminder).toContain("reference secrets by name");
  }, 20_000);

  test("routes a namespaced call to a real subprocess server", async () => {
    const result = await client.callTool({
      name: "lsp_echo",
      arguments: { text: "through-the-gateway" },
    });
    const payload = JSON.parse(textOf(result)) as {
      echo: string;
      from: string;
    };
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

  test("compresses gateway composite output but keeps status readable", async () => {
    const debug = await client.callTool({
      name: "arive_reasoned_debug",
      arguments: { symptom: "s".repeat(400) },
    });
    const envelope = JSON.parse(textOf(debug)) as {
      _arive_compressed: boolean;
      namespace: string;
      ref: string;
    };
    expect(envelope._arive_compressed).toBe(true);
    expect(envelope.namespace).toBe("arive");

    const recovered = await client.callTool({
      name: "context_retrieve",
      arguments: { ref: envelope.ref },
    });
    const payload = JSON.parse(textOf(recovered)) as { content: string };
    expect(payload.content).toContain("s".repeat(400));

    // The health report must never be hidden behind a ref.
    const status = await client.callTool({
      name: "arive_status",
      arguments: {},
    });
    const health = JSON.parse(textOf(status)) as { namespaces: unknown };
    expect(health.namespaces).toBeDefined();
  });

  test("reports namespace health", async () => {
    const status = await client.callTool({
      name: "arive_status",
      arguments: {},
    });
    const payload = JSON.parse(textOf(status)) as {
      namespaces: Record<string, { tools: number; enabled: boolean; usable: boolean }>;
      downstreams: Array<{ namespace: string; enabled: boolean }>;
    };
    expect(Object.keys(payload.namespaces).sort()).toEqual(
      [...NAMESPACES].sort(),
    );
    expect(payload.namespaces.context?.tools).toBeGreaterThanOrEqual(3);
    // The in-process ruleset is live without any downstream server.
    expect(payload.namespaces.fable).toEqual({
      tools: 3,
      enabled: false,
      usable: true,
    });
    expect(
      payload.downstreams.find((entry) => entry.namespace === "lsp")?.enabled,
    ).toBe(true);
    expect(payload.downstreams.filter((entry) => entry.enabled)).toHaveLength(
      2,
    );
  });

  test("returns a structured error for unknown tools", async () => {
    const result = await client.callTool({
      name: "nope_missing",
      arguments: {},
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain("Unknown tool");
  });

  test("indexes and retrieves a corpus with citations", async () => {
    const corpus = path.join(tempDir, "corpus.ts");
    const indexed = await client.callTool({
      name: "rag_index",
      arguments: { path: corpus },
    });
    const summary = JSON.parse(textOf(indexed)) as {
      files: { scanned: number; indexed: number };
      chunks: { added: number };
    };
    expect(summary.files.indexed).toBe(1);
    expect(summary.chunks.added).toBeGreaterThan(0);

    const queried = await client.callTool({
      name: "rag_query",
      arguments: { query: "gatewayRetrievalProof", topK: 3 },
    });
    const payload = JSON.parse(textOf(queried)) as {
      count: number;
      citations: string[];
      _arive_compressed?: boolean;
    };
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.citations[0]).toMatch(/corpus\.ts:\d+-\d+$/);
    // Retrieval payloads stay readable: compression would bury the answer.
    expect(payload._arive_compressed).toBeUndefined();
  }, 20_000);
});
