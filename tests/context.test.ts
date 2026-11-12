import { describe, expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ContextCompressor } from "../src/core/compressor.js";
import type { LocalTool } from "../src/core/results.js";
import { createContextTools } from "../src/local/context.js";

function jsonOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

const compressor = new ContextCompressor({
  enabled: true,
  thresholdTokens: 10,
  maxEntries: 10,
  previewChars: 40,
});
const tools = Object.fromEntries(
  createContextTools(compressor).map((tool) => [tool.name, tool]),
) as Record<string, LocalTool>;

describe("context adapter", () => {
  test("compress and retrieve round-trip losslessly", async () => {
    const original = "context payload ".repeat(40);
    const compressed = jsonOf(
      await tools.context_compress!.handler({
        content: original,
        force: true,
      }),
    );
    expect(compressed.compressed).toBe(true);
    const ref = String(compressed.ref);
    expect(ref.startsWith("ctx:")).toBe(true);

    const envelope = JSON.parse(String(compressed.envelope)) as {
      namespace: string;
    };
    expect(envelope.namespace).toBe("context");

    const retrieved = jsonOf(
      await tools.context_retrieve!.handler({ ref }),
    );
    expect(retrieved.content).toBe(original);
  });

  test("reports an error for an unknown ref", async () => {
    const result = await tools.context_retrieve!.handler({
      ref: "ctx:00000000000000000000000000000000",
    });
    expect(result.isError).toBe(true);
  });

  test("exposes no contentType knob", () => {
    const properties = tools.context_compress!.inputSchema.properties;
    expect(Object.keys(properties).sort()).toEqual(["content", "force"]);
  });

  test("blames configuration, not payload size, when compression is off", async () => {
    const off = new ContextCompressor({
      enabled: false,
      thresholdTokens: 10,
      maxEntries: 10,
      previewChars: 40,
    });
    const offTools = Object.fromEntries(
      createContextTools(off).map((tool) => [tool.name, tool]),
    ) as Record<string, LocalTool>;

    const refused = await offTools.context_compress!.handler({
      content: "y".repeat(400),
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("disabled by configuration");

    // The escape hatch still works and reports a real ref.
    const forced = jsonOf(
      await offTools.context_compress!.handler({
        content: "y".repeat(400),
        force: true,
      }),
    );
    expect(forced.compressed).toBe(true);
    expect(off.retrieve(String(forced.ref))).toBe("y".repeat(400));
  });

  test("still reports the threshold for an enabled store", async () => {
    const small = await tools.context_compress!.handler({ content: "tiny" });
    expect(small.isError).toBeUndefined();
    expect(JSON.stringify(small.content)).toContain("under the configured threshold");
  });
});
