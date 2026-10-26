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
