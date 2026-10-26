import { describe, expect, test } from "bun:test";
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
});
