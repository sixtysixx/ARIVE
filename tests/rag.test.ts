import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RagConfig } from "../src/core/config.js";
import type { LocalTool } from "../src/core/results.js";
import {
  chunkText,
  extractIdentifiers,
  hasLongLine,
} from "../src/local/rag/chunker.js";
import {
  createEmbeddingProvider,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OPENAI_URL,
  type EmbeddingProvider,
} from "../src/local/rag/embeddings.js";
import { RagStore } from "../src/local/rag/store.js";
import { createRagTools } from "../src/local/rag/tools.js";

function jsonOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

function ragConfig(dbPath: string, overrides: Partial<RagConfig> = {}): RagConfig {
  return {
    dbPath,
    chunkChars: 1200,
    chunkOverlapChars: 200,
    maxFileBytes: 1_000_000,
    maxFiles: 20_000,
    defaultTopK: 8,
    maxTopK: 50,
    maxPerFile: 3,
    maxVectorScan: 50_000,
    embeddings: {
      provider: "none",
      apiKeyEnv: "OPENAI_API_KEY",
      batchSize: 32,
      timeoutMs: 30_000,
    },
    ...overrides,
  };
}

/** Line splitting that mirrors the chunker, so ranges can be verified. */
function sourceLines(content: string): string[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const tempDirs: string[] = [];
const stores: RagStore[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function openStore(
  config: RagConfig,
  provider?: EmbeddingProvider,
): RagStore {
  const store = new RagStore(config, provider);
  stores.push(store);
  return store;
}

afterAll(() => {
  for (const store of stores) {
    try {
      store.close();
    } catch {
      // Already closed.
    }
  }
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch {
      // Windows may briefly hold the SQLite WAL handle; the temp dir is disposable.
    }
  }
});

describe("chunker", () => {
  test("line ranges round-trip to the source text", () => {
    const content = Array.from(
      { length: 60 },
      (_, i) => `line ${i} with a handful of words`,
    ).join("\n");
    const chunks = chunkText(content, 300, 60);
    expect(chunks.length).toBeGreaterThan(3);
    const lines = sourceLines(content);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(
        lines.slice(chunk.startLine - 1, chunk.endLine).join("\n"),
      );
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  test("consecutive chunks overlap", () => {
    const content = Array.from(
      { length: 200 },
      (_, i) => `short line ${i}`,
    ).join("\n");
    const chunks = chunkText(content, 300, 80);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.startLine).toBeLessThanOrEqual(chunks[i - 1]!.endLine);
    }
    expect(
      chunks.some(
        (chunk, i) => i > 0 && chunk.startLine < chunks[i - 1]!.endLine,
      ),
    ).toBe(true);
  });

  test("prefers headings and blank lines as cut points", () => {
    const blocks = Array.from(
      { length: 40 },
      (_, i) => `# Section ${i}\ncontent ${i} alpha\ncontent ${i} beta`,
    );
    const content = blocks.join("\n\n");
    const chunks = chunkText(content, 240, 40);
    const lines = sourceLines(content);
    expect(chunks.length).toBeGreaterThan(3);
    const isBoundary = (index: number): boolean =>
      lines[index]!.trim() === "" || /^\s{0,3}#{1,6}\s/.test(lines[index]!);
    // Every chunk that did not reach EOF ends where a boundary was found, and
    // at least one of those cuts lands on a heading.
    const bounded = chunks.filter((chunk) => chunk.endLine < lines.length);
    expect(bounded.length).toBeGreaterThan(0);
    for (const chunk of bounded) {
      expect(isBoundary(chunk.endLine - 1)).toBe(true);
    }
    expect(
      bounded.some((chunk) =>
        /^\s{0,3}#{1,6}\s/.test(lines[chunk.endLine - 1]!),
      ),
    ).toBe(true);
  });

  test("emits a line longer than maxChars whole", () => {
    const long = "y".repeat(500);
    const chunks = chunkText(long, 100, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe(long);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(1);
  });

  test("flags single lines over the threshold", () => {
    expect(hasLongLine(`ok\n${"z".repeat(5000)}\nok`)).toBe(true);
    expect(hasLongLine("short\nlines\nhere")).toBe(false);
    expect(hasLongLine("z".repeat(5000), 6000)).toBe(false);
  });

  test("flattens identifiers into searchable words", () => {
    const idents = extractIdentifiers("CompressPayload ARIVE_rag_store").split(
      " ",
    );
    expect(idents).toContain("compresspayload");
    expect(idents).toContain("compress");
    expect(idents).toContain("payload");
    expect(idents).toContain("arive");
    expect(idents).toContain("store");
    expect(new Set(idents).size).toBe(idents.length);
  });
});

describe("index lifecycle", () => {
  let fixtureDir: string;
  let store: RagStore;

  beforeAll(() => {
    const root = tempDir("arive-rag-");
    fixtureDir = path.join(root, "corpus");
    fs.mkdirSync(fixtureDir);
    fs.writeFileSync(
      path.join(fixtureDir, "a.ts"),
      'export function CompressPayload() {\n  return "compress-payload";\n}\n',
    );
    fs.writeFileSync(
      path.join(fixtureDir, "b.md"),
      "# Retrieval Notes\n\nThe gateway chunks text by line ranges.\n",
    );
    fs.writeFileSync(
      path.join(fixtureDir, "bin.dat"),
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x04]),
    );
    fs.writeFileSync(path.join(fixtureDir, "huge.txt"), "x".repeat(600));
    store = openStore(ragConfig(path.join(root, "rag.db"), { maxFileBytes: 500 }));
  });

  test("indexes scannable files and skips binaries and oversized files", async () => {
    const summary = await store.index({ path: fixtureDir });
    const files = summary.files as Record<string, number>;
    expect(files.scanned).toBe(4);
    expect(files.indexed).toBe(2);
    expect(files.skipped).toBe(2);
    expect(summary.truncated).toBe(false);

    const stats = store.stats();
    expect(stats.files).toBe(2);
    expect(stats.chunks as number).toBeGreaterThan(0);
    expect((stats.embeddings as Record<string, unknown>).provider).toBe("none");
  });

  test("retrieves an identifier with a line citation", async () => {
    const result = await store.query({ query: "CompressPayload" });
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(String(results[0]!.path)).toMatch(/a\.ts$/);
    expect(String(results[0]!.citation)).toMatch(/a\.ts:\d+-\d+$/);
    expect(String(results[0]!.text)).toContain("CompressPayload");
    expect(result.citations).toContain(results[0]!.citation);
    const vectorSearch = result.vectorSearch as Record<string, unknown>;
    expect(vectorSearch.enabled).toBe(false);
    expect(result.degraded).toBeUndefined();
  });

  test("is incremental and reindexes changed content", async () => {
    const again = await store.index({ path: fixtureDir });
    expect((again.files as Record<string, number>).indexed).toBe(0);
    expect((again.files as Record<string, number>).unchanged).toBe(2);

    const file = path.join(fixtureDir, "a.ts");
    fs.writeFileSync(
      file,
      'export function RenamedPayloadHandler() {\n  return "renamed";\n}\n',
    );
    // Filesystem timestamps are coarse; advance mtime explicitly so the
    // mtime shortcut cannot mask the change.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(file, future, future);

    const changed = await store.index({ path: fixtureDir });
    expect((changed.files as Record<string, number>).indexed).toBe(1);

    const stale = await store.query({ query: "CompressPayload" });
    expect(stale.count).toBe(0);
    const fresh = await store.query({ query: "RenamedPayloadHandler" });
    expect(fresh.count as number).toBeGreaterThan(0);
  });

  test("prunes files that disappeared", async () => {
    fs.rmSync(path.join(fixtureDir, "b.md"));
    const summary = await store.index({ path: fixtureDir });
    expect((summary.files as Record<string, number>).removed).toBe(1);
    expect(store.stats().files).toBe(1);
  });

  test("sanitizes hostile FTS syntax", async () => {
    const result = await store.query({ query: 'foo" OR "bar NEAR( baz*' });
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
  });
});

describe("vector search", () => {
  function fakeProvider(): EmbeddingProvider {
    return {
      id: "fake:unit",
      provider: "ollama",
      model: "unit",
      embed: async (texts: string[]) =>
        texts.map((text) =>
          text.includes("semantic-probe") || text.includes("unrelated wording")
            ? new Float32Array([1, 0])
            : new Float32Array([0, 1]),
        ),
    };
  }

  test("contributes hits with no lexical overlap", async () => {
    const root = tempDir("arive-rag-vector-");
    fs.writeFileSync(
      path.join(root, "notes.md"),
      "# Notes\n\nunrelated wording about nothing in particular\n",
    );
    const store = openStore(
      ragConfig(path.join(root, "rag.db")),
      fakeProvider(),
    );
    await store.index({ path: root });
    const result = await store.query({ query: "semantic-probe" });
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBe(1);
    expect(results[0]!.path).toMatch(/notes\.md$/);
    expect(Number(results[0]!.vectorScore)).toBeGreaterThan(0.99);
    expect(results[0]!.lexicalScore).toBeUndefined();
    const vectorSearch = result.vectorSearch as Record<string, unknown>;
    expect(vectorSearch.enabled).toBe(true);
    expect(result.degraded).toBeUndefined();
  });

  test("degrades to lexical results when the provider fails", async () => {
    const root = tempDir("arive-rag-degrade-");
    fs.writeFileSync(
      path.join(root, "notes.md"),
      "embeddingFailureKeyword appears in this file\n",
    );
    const failing: EmbeddingProvider = {
      id: "fake:failing",
      provider: "ollama",
      model: "failing",
      embed: async () => {
        throw new Error("provider offline");
      },
    };
    const store = openStore(ragConfig(path.join(root, "rag.db")), failing);
    const summary = await store.index({ path: root });
    const embeddings = summary.embeddings as Record<string, unknown>;
    expect(Number(embeddings.failed)).toBeGreaterThan(0);
    expect(String(embeddings.error)).toContain("provider offline");

    const result = await store.query({ query: "embeddingFailureKeyword" });
    expect(result.count).toBe(1);
    const degraded = result.degraded as { reason: string };
    expect(degraded.reason.length).toBeGreaterThan(0);
    expect((result.vectorSearch as Record<string, unknown>).enabled).toBe(true);
  });

  test("reports a truncated vector scan", async () => {
    const root = tempDir("arive-rag-scan-");
    fs.writeFileSync(
      path.join(root, "long.md"),
      Array.from({ length: 30 }, (_, i) => `alpha beta line ${i}`).join("\n"),
    );
    const store = openStore(
      ragConfig(path.join(root, "rag.db"), {
        chunkChars: 100,
        chunkOverlapChars: 20,
        maxVectorScan: 1,
      }),
      fakeProvider(),
    );
    await store.index({ path: root });
    const result = await store.query({ query: "alpha" });
    const vectorSearch = result.vectorSearch as Record<string, unknown>;
    expect(vectorSearch.truncated).toBe(true);
    expect(Number(vectorSearch.scanned)).toBe(1);
  });

  test("filters by path", async () => {
    const root = tempDir("arive-rag-filter-");
    const keep = path.join(root, "keep");
    const other = path.join(root, "other");
    fs.mkdirSync(keep);
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(keep, "x.ts"), "const FilterProbeToken = 1;\n");
    fs.writeFileSync(path.join(other, "y.ts"), "const FilterProbeToken = 2;\n");
    const store = openStore(ragConfig(path.join(root, "rag.db")));
    await store.index({ path: root });

    const all = await store.query({ query: "FilterProbeToken" });
    expect(all.count).toBe(2);

    const scoped = await store.query({
      query: "FilterProbeToken",
      path: keep,
    });
    const results = scoped.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(String(results[0]!.citation)).toContain("keep");
  });

  test("forget drops a subtree and refuses the filesystem root", async () => {
    const root = tempDir("arive-rag-forget-");
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "n.ts"), "const ForgetProbe = 1;\n");
    const store = openStore(ragConfig(path.join(root, "rag.db")));
    await store.index({ path: root });
    expect(store.stats().files).toBe(1);

    const removed = store.forget(nested);
    expect(removed.removed).toBe(true);
    expect(Number(removed.chunks)).toBeGreaterThan(0);
    expect(store.stats().files).toBe(0);

    expect(() => store.forget(path.parse(process.cwd()).root)).toThrow(
      /filesystem root/,
    );
  });

  /** A provider whose vector width changes after the first call. */
  function driftingProvider(widths: number[]): EmbeddingProvider {
    let call = 0;
    return {
      id: "fake:drift",
      provider: "ollama",
      model: "drift",
      embed: async (texts: string[]) => {
        const width = widths[Math.min(call, widths.length - 1)]!;
        call += 1;
        return texts.map(() => new Float32Array(width).fill(1));
      },
    };
  }

  test("force re-embeds after the provider's vector width changes", async () => {
    const root = tempDir("arive-rag-drift-");
    fs.writeFileSync(path.join(root, "one.ts"), "const DriftProbe = 1;\n");
    const store = openStore(
      ragConfig(path.join(root, "rag.db")),
      driftingProvider([2, 4]),
    );
    await store.index({ path: root });

    await store.index({ path: root, force: true });

    const stats = store.stats();
    expect((stats.embeddings as Record<string, unknown>).dimensions).toBe(4);
    expect(stats.embeddedChunks).toBe(stats.chunks as number);
  });

  test("refuses a width change without force", async () => {
    const root = tempDir("arive-rag-drift-refuse-");
    fs.writeFileSync(path.join(root, "one.ts"), "const DriftProbe = 1;\n");
    const store = openStore(
      ragConfig(path.join(root, "rag.db")),
      driftingProvider([2, 4]),
    );
    await store.index({ path: root });

    // A new file forces an embed call, which is where the width is observed.
    fs.writeFileSync(path.join(root, "two.ts"), "const DriftProbeToo = 2;\n");
    await expect(store.index({ path: root })).rejects.toThrow(
      /force:true to re-embed the corpus with "fake:drift"/,
    );
  });

  test("reports chunks that still lack embeddings", async () => {
    const root = tempDir("arive-rag-partial-");
    fs.writeFileSync(path.join(root, "a.md"), "PartialCoverageToken here\n");
    fs.writeFileSync(path.join(root, "b.md"), "OtherPartialToken there\n");
    let call = 0;
    const partial: EmbeddingProvider = {
      id: "fake:partial",
      provider: "ollama",
      model: "partial",
      embed: async (texts: string[]) => {
        call += 1;
        if (call > 1) throw new Error("provider offline");
        return texts.map(() => new Float32Array([1, 0]));
      },
    };
    const store = openStore(ragConfig(path.join(root, "rag.db")), partial);
    await store.index({ path: root });

    const result = await store.query({ query: "PartialCoverageToken" });
    const vectorSearch = result.vectorSearch as Record<string, unknown>;
    expect(Number(vectorSearch.pending)).toBeGreaterThan(0);
    const degraded = result.degraded as { reason: string };
    expect(degraded.reason.length).toBeGreaterThan(0);
  });
});

describe("embedding providers", () => {
  test("no provider configured means no network path", () => {
    expect(
      createEmbeddingProvider({
        provider: "none",
        apiKeyEnv: "OPENAI_API_KEY",
        batchSize: 32,
        timeoutMs: 1000,
      }),
    ).toBeUndefined();
    expect(DEFAULT_OLLAMA_URL).toContain("11434");
    expect(DEFAULT_OPENAI_URL.endsWith("/v1")).toBe(true);
  });

  test("ollama batches requests and returns normalized vectors", async () => {
    const requests: Array<{ path: string; input: string[] }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { input: string[] };
        requests.push({ path: new URL(request.url).pathname, input: body.input });
        return Response.json({
          embeddings: body.input.map(() => [3, 4]),
        });
      },
    });
    try {
      const provider = createEmbeddingProvider({
        provider: "ollama",
        baseUrl: `http://127.0.0.1:${server.port}/`,
        apiKeyEnv: "OPENAI_API_KEY",
        batchSize: 2,
        timeoutMs: 5000,
      })!;
      expect(provider.id).toBe("ollama:nomic-embed-text");
      const vectors = await provider.embed(["a", "b", "c"]);
      expect(requests).toHaveLength(2);
      expect(requests[0]!.path).toBe("/api/embed");
      expect(requests[1]!.input).toEqual(["c"]);
      expect(vectors).toHaveLength(3);
      for (const vector of vectors) {
        expect(vector.length).toBe(2);
        expect(Math.hypot(vector[0]!, vector[1]!)).toBeCloseTo(1, 6);
      }
    } finally {
      server.stop(true);
    }
  });

  test("openai sends auth and respects response ordering", async () => {
    let captured: { path: string; authorization: string | null; model: string } =
      { path: "", authorization: null, model: "" };
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { model: string };
        captured = {
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          model: body.model,
        };
        return Response.json({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        });
      },
    });
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const provider = createEmbeddingProvider({
        provider: "openai",
        baseUrl: `http://127.0.0.1:${server.port}/v1/`,
        apiKeyEnv: "OPENAI_API_KEY",
        batchSize: 8,
        timeoutMs: 5000,
      })!;
      expect(provider.id).toBe("openai:text-embedding-3-small");
      const vectors = await provider.embed(["x", "y"]);
      expect(captured.path).toBe("/v1/embeddings");
      expect(captured.authorization).toBe("Bearer test-key");
      expect(captured.model).toBe("text-embedding-3-small");
      expect(Array.from(vectors[0]!)).toEqual([1, 0]);
      expect(Array.from(vectors[1]!)).toEqual([0, 1]);
    } finally {
      server.stop(true);
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  test("openai without a key fails with an actionable message", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnv: "OPENAI_API_KEY",
        batchSize: 8,
        timeoutMs: 5000,
      })!;
      await expect(provider.embed(["x"])).rejects.toThrow(/requires OPENAI_API_KEY/);
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe("rag tools", () => {
  let store: RagStore;
  let tools: Record<string, LocalTool>;
  let root: string;

  beforeAll(() => {
    root = tempDir("arive-rag-tools-");
    fs.writeFileSync(
      path.join(root, "corpus.ts"),
      "export const gatewayToken = 'value';\n",
    );
    store = openStore(ragConfig(path.join(root, "rag.db")));
    tools = Object.fromEntries(
      createRagTools(store).map((tool) => [tool.name, tool]),
    );
  });

  test("index, query, stats, and forget round-trip through tools", async () => {
    const indexed = jsonOf(
      await tools.rag_index!.handler({ path: root, glob: "*.ts" }),
    );
    expect((indexed.files as Record<string, number>).indexed).toBe(1);

    const queried = jsonOf(
      await tools.rag_query!.handler({ query: "gatewayToken", topK: 3 }),
    );
    expect(queried.count).toBe(1);
    expect(String((queried.citations as string[])[0])).toMatch(
      /corpus\.ts:\d+-\d+$/,
    );

    const stats = jsonOf(await tools.rag_stats!.handler({}));
    expect(stats.files).toBe(1);

    const forgotten = jsonOf(await tools.rag_forget!.handler({ path: root }));
    expect(forgotten.removed).toBe(true);
  });

  test("returns a structured error for a bad path", async () => {
    const missing = path.join(root, "does-not-exist");
    const result = await tools.rag_index!.handler({ path: missing });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Path not found");
  });
});
