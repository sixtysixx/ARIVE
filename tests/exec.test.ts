import { describe, expect, test } from "bun:test";
import { runCommand } from "../src/core/exec.js";

const node = process.execPath;

describe("runCommand", () => {
  test("keeps the buffered stdout path unchanged", async () => {
    const result = await runCommand(node, [
      "-e",
      "console.log('a');console.log('b')",
    ]);
    expect(result.stdout).toBe("a\nb\n");
    expect(result.stopped).toBe(false);
    expect(result.truncated).toBe(false);
  });

  test("stops at the first line the callback rejects", async () => {
    const result = await runCommand(
      node,
      ["-e", "console.log('a');console.log('b');console.log('c')"],
      {
        onStdoutLine: (line) => line !== "a",
      },
    );
    expect(result.stopped).toBe(true);
    // The callback owns stdout: buffering it as well would defeat the point.
    expect(result.stdout).toBe("");
  });

  test("delivers every line when the callback never stops", async () => {
    const lines: string[] = [];
    const result = await runCommand(
      node,
      ["-e", "process.stdout.write('a\\n');process.stdout.write('b\\nc')"],
      {
        onStdoutLine: (line) => {
          lines.push(line);
        },
      },
    );
    expect(result.stopped).toBe(false);
    // A trailing fragment without a newline still reaches the callback.
    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("kills a child that floods a single line past the byte cap", async () => {
    const result = await runCommand(
      node,
      ["-e", "process.stdout.write('x'.repeat(50000))"],
      { maxBytes: 1000, onStdoutLine: () => {} },
    );
    expect(result.truncated).toBe(true);
    expect(result.stopped).toBe(true);
  });

  test("keeps stderr available for a stopped child", async () => {
    const result = await runCommand(
      node,
      ["-e", "console.error('noise');console.log('a');console.log('b')"],
      { onStdoutLine: () => false },
    );
    expect(result.stopped).toBe(true);
    expect(result.stderr).toContain("noise");
  });
});
