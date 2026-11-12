import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LocalTool } from "../src/core/results.js";
import { runCommand } from "../src/core/exec.js";
import { createSearchTools } from "../src/local/search.js";

function jsonOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

let dir: string;
let tools: Record<string, LocalTool>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-search-"));
  fs.writeFileSync(path.join(dir, "a.ts"), "const needle = 1;\n");
  fs.writeFileSync(path.join(dir, "b.ts"), "const needle = 2;\n");
  fs.writeFileSync(path.join(dir, "c.md"), "needle in docs\n");
  tools = Object.fromEntries(
    createSearchTools(10).map((tool) => [tool.name, tool]),
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("search adapter", () => {
  test("reports truncation when a query hits the result cap", async () => {
    const capped = jsonOf(
      await tools.search_query!.handler({
        pattern: "needle",
        path: dir,
        maxResults: 2,
      }),
    );
    expect(capped.count).toBe(2);
    expect(capped.truncated).toBe(true);
    expect((capped.matches as unknown[]).length).toBe(2);

    const full = jsonOf(
      await tools.search_query!.handler({
        pattern: "needle",
        path: dir,
        maxResults: 10,
      }),
    );
    expect(full.count).toBe(3);
    expect(full.truncated).toBe(false);
  });

  test("reports no truncation when nothing matches", async () => {
    const empty = jsonOf(
      await tools.search_query!.handler({
        pattern: "no-such-token-anywhere",
        path: dir,
      }),
    );
    expect(empty.count).toBe(0);
    expect(empty.truncated).toBe(false);
  });

  test("reports truncation when a file listing hits the result cap", async () => {
    const capped = jsonOf(
      await tools.search_files!.handler({
        path: dir,
        glob: "*.ts",
        maxResults: 1,
      }),
    );
    expect(capped.count).toBe(1);
    expect(capped.truncated).toBe(true);

    const full = jsonOf(
      await tools.search_files!.handler({
        path: dir,
        glob: "*.ts",
        maxResults: 10,
      }),
    );
    expect(full.count).toBe(2);
    expect(full.truncated).toBe(false);
  });

  test("distinguishes a killed child from a binary that never started", async () => {
    // "Install ripgrep" is only truthful when the process never started; a
    // killed child also reports code null, so the two outcomes need a field.
    const killed = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      { timeoutMs: 300 },
    );
    expect(killed.code).toBeNull();
    expect(killed.signal).toBeTruthy();

    const missing = await runCommand("definitely-not-a-real-binary-xyz", []);
    expect(missing.code).toBeNull();
    expect(missing.signal).toBeNull();
  });

  test("still asks for ripgrep when the binary cannot be started", async () => {
    const saved = { PATH: process.env.PATH, Path: process.env.Path };
    delete process.env.PATH;
    delete process.env.Path;
    try {
      const result = await tools.search_query!.handler({
        pattern: "needle",
        path: dir,
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("not runnable");
      expect(JSON.stringify(result.content)).not.toContain("killed by");
    } finally {
      if (saved.PATH) process.env.PATH = saved.PATH;
      if (saved.Path) process.env.Path = saved.Path;
    }
  });
});
