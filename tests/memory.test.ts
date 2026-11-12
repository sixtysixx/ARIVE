import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMemoryTools, MemoryStore } from "../src/local/memory.js";
import type { LocalTool } from "../src/core/results.js";

function jsonOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

let dir: string;
let store: MemoryStore;
let tools: Record<string, LocalTool>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-memory-"));
  store = new MemoryStore({
    dbPath: path.join(dir, "memory.db"),
    maxItems: 100,
  });
  tools = Object.fromEntries(
    createMemoryTools(store).map((tool) => [tool.name, tool]),
  );
});

afterAll(() => {
  store.close();
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
});

describe("memory adapter", () => {
  test("stores and recalls a drawer", async () => {
    const written = jsonOf(
      await tools.mem_remember!.handler({
        content: "The gateway compresses payloads above 2000 tokens.",
        wing: "codebase",
        room: "gateway",
        hall: "facts",
        tags: ["compression"],
        importance: 7,
      }),
    );
    expect(written.status).toBe("remembered");
    expect(String(written.drawerId).startsWith("mem:")).toBe(true);

    const recalled = jsonOf(
      await tools.mem_recall!.handler({ query: "compresses", limit: 10 }),
    );
    const results = recalled.results as Array<{
      content: string;
      importance: number;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain("2000 tokens");
    expect(results[0]?.importance).toBe(7);
  });

  test("is idempotent for identical content", async () => {
    const args = {
      content: "idempotent fact",
      wing: "codebase",
      room: "gateway",
      hall: "facts",
    };
    const first = jsonOf(await tools.mem_remember!.handler(args));
    const second = jsonOf(await tools.mem_remember!.handler(args));
    expect(second.drawerId).toBe(first.drawerId);

    const recalled = jsonOf(
      await tools.mem_recall!.handler({ query: "idempotent" }),
    );
    expect((recalled.results as unknown[]).length).toBe(1);
  });

  test("merges tags when the same drawer is rewritten", async () => {
    const base = {
      content: "tag merging target",
      wing: "codebase",
      room: "general",
    };
    const first = jsonOf(
      await tools.mem_remember!.handler({ ...base, tags: ["a"] }),
    );
    const second = jsonOf(
      await tools.mem_remember!.handler({ ...base, tags: ["b", "a"] }),
    );
    expect(second.drawerId).toBe(first.drawerId);

    const recalled = jsonOf(
      await tools.mem_recall!.handler({ query: "tag merging target" }),
    );
    const rows = recalled.results as Array<{ tags: string[] }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tags).toEqual(["a", "b"]);
  });

  test("enforces a lowered maxItems at startup", async () => {
    const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-cap-"));
    const dbPath = path.join(capDir, "memory.db");
    try {
      const wide = new MemoryStore({ dbPath, maxItems: 10 });
      for (const [index, content] of ["one", "two", "three"].entries()) {
        wide.write({
          content: `capped drawer ${content}`,
          wing: "codebase",
          room: "general",
          hall: "facts",
          tags: [],
          importance: index + 1,
        });
      }
      expect(wide.stats().totalDrawers).toBe(3);
      wide.close();

      // Reopening with a smaller cap must not leave the store oversized.
      const narrow = new MemoryStore({ dbPath, maxItems: 1 });
      expect(narrow.stats().totalDrawers).toBe(1);
      narrow.close();
    } finally {
      try {
        fs.rmSync(capDir, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        // Windows may hold the WAL handle briefly; the temp dir is disposable.
      }
    }
  });

  test("filters by hall", async () => {
    await tools.mem_remember!.handler({
      content: "Decision: keep downstream servers lazy.",
      hall: "decisions",
      room: "architecture",
    });
    const recalled = jsonOf(
      await tools.mem_recall!.handler({ hall: "decisions", limit: 10 }),
    );
    const results = recalled.results as Array<{ hall: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.hall === "decisions")).toBe(true);
  });

  test("counts each recall as an access", async () => {
    await tools.mem_remember!.handler({
      content: "recall bumps the access counter",
      hall: "findings",
    });

    type Entry = {
      accessCount: number;
      lastAccessed: string;
      createdAt: string;
    };
    const first = jsonOf(
      await tools.mem_recall!.handler({ query: "bumps the access" }),
    );
    const rows = first.results as Entry[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accessCount).toBe(2);
    expect(new Date(rows[0]!.lastAccessed).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[0]!.createdAt).getTime(),
    );

    const second = jsonOf(
      await tools.mem_recall!.handler({ query: "bumps the access" }),
    );
    expect((second.results as Entry[])[0]!.accessCount).toBe(3);
  });

  test("normalizes wing filters the same way it normalizes writes", async () => {
    await tools.mem_remember!.handler({
      content: "wing normalization works",
      wing: "My Wing",
    });
    const recalled = jsonOf(
      await tools.mem_recall!.handler({ wing: "My Wing", limit: 10 }),
    );
    const results = recalled.results as Array<{ content: string; wing: string }>;
    expect(results).toHaveLength(1);
    expect(results[0]!.wing).toBe("my-wing");
    expect(results[0]!.content).toContain("wing normalization works");
  });

  test("treats LIKE wildcards in a query as literal text", async () => {
    await tools.mem_remember!.handler({
      content: "progress 100 percent",
      hall: "findings",
    });

    const literal = jsonOf(
      await tools.mem_recall!.handler({ query: "100%" }),
    );
    expect((literal.results as unknown[]).length).toBe(0);

    const spelled = jsonOf(
      await tools.mem_recall!.handler({ query: "100 percent" }),
    );
    expect((spelled.results as unknown[]).length).toBe(1);
  });

  test("forgets a drawer and reports stats", async () => {
    const written = jsonOf(
      await tools.mem_remember!.handler({
        content: "temporary fact",
        hall: "facts",
      }),
    );
    const forgotten = jsonOf(
      await tools.mem_forget!.handler({ drawerId: written.drawerId }),
    );
    expect(forgotten.removed).toBe(true);

    const stats = jsonOf(await tools.mem_stats!.handler({}));
    expect(Number(stats.totalDrawers)).toBeGreaterThan(0);
    expect(Number(stats.wings)).toBeGreaterThan(0);
  });
});
