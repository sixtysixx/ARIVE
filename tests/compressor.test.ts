import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ContextCompressor } from "../src/core/compressor.js";

function makeCompiler(maxEntries = 10): ContextCompressor {
  return new ContextCompressor({
    enabled: true,
    thresholdTokens: 10, // 40 chars
    maxEntries,
    previewChars: 40,
  });
}

describe("ContextCompressor", () => {
  test("leaves small payloads untouched", () => {
    const compressor = makeCompiler();
    const result = compressor.compressText("short", "test");
    expect(result.compressed).toBe(false);
    expect(result.text).toBe("short");
  });

  test("stores oversized payloads and retrieves them losslessly", () => {
    const compressor = makeCompiler();
    const original = "x".repeat(200) + "END";
    const result = compressor.compressText(original, "search");
    expect(result.compressed).toBe(true);
    expect(result.ref?.startsWith("ctx:")).toBe(true);
    expect(compressor.retrieve(result.ref!)).toBe(original);
  });

  test("force stores even below the threshold", () => {
    const compressor = makeCompiler();
    const result = compressor.compressText("tiny", "test", true);
    expect(result.compressed).toBe(true);
    expect(compressor.retrieve(result.ref!)).toBe("tiny");
  });

  test("apply preserves non-text blocks and compresses text blocks", () => {
    const compressor = makeCompiler();
    const result: CallToolResult = {
      content: [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "y".repeat(200) },
      ],
    };
    const compressed = compressor.apply(result, "lsp");
    expect(compressed.content).toHaveLength(2);
    expect(compressed.content[0]).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
    const text = compressed.content[1];
    expect(text.type).toBe("text");
    if (text.type !== "text") throw new Error("expected text block");
    const envelope = JSON.parse(text.text) as {
      ref: string;
      _arive_compressed: boolean;
    };
    expect(envelope._arive_compressed).toBe(true);
    expect(compressor.retrieve(envelope.ref)).toBe("y".repeat(200));
  });

  test("evicts least recently used entries", () => {
    const compressor = makeCompiler(2);
    const a = compressor.compressText("a".repeat(60), "test");
    const b = compressor.compressText("b".repeat(60), "test");
    // Touch `a` so `b` becomes the least recently used entry.
    expect(compressor.retrieve(a.ref!)).toBe("a".repeat(60));
    compressor.compressText("c".repeat(60), "test");

    expect(compressor.stats().entries).toBe(2);
    expect(compressor.retrieve(a.ref!)).toBe("a".repeat(60));
    expect(compressor.retrieve(b.ref!)).toBeNull();
  });

  test("reports stats", () => {
    const compressor = makeCompiler();
    compressor.compressText("z".repeat(100), "test");
    const stats = compressor.stats();
    expect(stats.compressions).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.thresholdTokens).toBe(10);
  });

  test("flags the structured content it removes", () => {
    const compressor = makeCompiler();
    type Omitted = CallToolResult & { structuredContentOmitted?: boolean };

    const withStructured = compressor.apply(
      {
        content: [{ type: "text", text: "q".repeat(200) }],
        structuredContent: { rows: [1, 2, 3] },
      },
      "lsp",
    ) as Omitted;
    expect(withStructured.structuredContent).toBeUndefined();
    expect(withStructured.structuredContentOmitted).toBe(true);

    // A result that never carried structured content must not claim it lost any.
    const textOnly = compressor.apply(
      { content: [{ type: "text", text: "q".repeat(200) }] },
      "lsp",
    ) as Omitted;
    expect(textOnly.structuredContentOmitted).toBeUndefined();
  });

  test("never compresses error results", () => {
    const compressor = makeCompiler();
    const original: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "x".repeat(200) }],
    };
    const applied = compressor.apply(original, "lsp");
    expect(applied).toBe(original);
    expect(applied.content[0]).toEqual({ type: "text", text: "x".repeat(200) });
    expect(compressor.stats().compressions).toBe(0);
  });

  test("rejects refs it never minted instead of reading the disk store", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-store-"));
    try {
      // A payload sitting outside the store must stay unreachable by ref.
      fs.writeFileSync(path.join(os.tmpdir(), "arive-escape.txt"), "secret");
      const compressor = new ContextCompressor({
        enabled: true,
        thresholdTokens: 10,
        maxEntries: 10,
        previewChars: 40,
        storeDir,
      });

      expect(compressor.retrieve("ctx:../../arive-escape")).toBeNull();
      expect(compressor.retrieve("ctx:")).toBeNull();
      expect(compressor.retrieve("ctx:0123456789abcdef0123456789abcdef")).toBeNull();

      const stored = compressor.compressText("k".repeat(200), "test", true);
      expect(compressor.retrieve(stored.ref!)).toBe("k".repeat(200));
    } finally {
      fs.rmSync(path.join(os.tmpdir(), "arive-escape.txt"), { force: true });
      fs.rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("prunes stale disk entries while keeping fresh ones retrievable", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-store-"));
    try {
      const first = new ContextCompressor({
        enabled: true,
        thresholdTokens: 10,
        maxEntries: 10,
        previewChars: 40,
        storeDir,
      });
      const staleText = "s".repeat(200);
      const freshText = "f".repeat(200);
      const staleRef = first.compressText(staleText, "test");
      const freshRef = first.compressText(freshText, "test");
      const staleFile = path.join(storeDir, `${staleRef.ref!.slice(4)}.txt`);
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(staleFile, eightDaysAgo, eightDaysAgo);

      // A fresh compressor prunes on construction, before any lookup.
      const second = new ContextCompressor({
        enabled: true,
        thresholdTokens: 10,
        maxEntries: 10,
        previewChars: 40,
        storeDir,
      });

      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(path.join(storeDir, `${freshRef.ref!.slice(4)}.txt`))).toBe(
        true,
      );
      expect(second.retrieve(freshRef.ref!)).toBe(freshText);
      expect(second.retrieve(staleRef.ref!)).toBeNull();
    } finally {
      fs.rmSync(storeDir, { recursive: true, force: true });
    }
  });
});
