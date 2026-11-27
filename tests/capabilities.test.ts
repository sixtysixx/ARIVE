import { describe, expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NamespaceHealth } from "../src/core/registry.js";
import { NAMESPACES } from "../src/core/config.js";
import {
  ARIVE_CAPABILITIES,
  createCapabilityTool,
} from "../src/local/capabilities.js";

const INSTRUCTIONS = "ARIVE gateway. Route by job.";

function health(usable: boolean): NamespaceHealth {
  return { tools: usable ? 3 : 0, configured: true, usable };
}

function summary(overrides: Partial<Record<string, boolean>>) {
  const namespaces: Record<string, NamespaceHealth> = {};
  for (const namespace of NAMESPACES) {
    namespaces[namespace] = health(overrides[namespace] ?? true);
  }
  return namespaces;
}

interface Payload {
  instructions: string;
  capabilities: Array<{ tool: string; useWhen: string; available: boolean }>;
  namespaces: Record<string, NamespaceHealth>;
}

function call(
  args: Record<string, unknown>,
  overrides: Partial<Record<string, boolean>> = {},
): Payload {
  const tool = createCapabilityTool({
    instructions: INSTRUCTIONS,
    summary: () => summary(overrides),
  });
  const result = tool.handler(args) as CallToolResult;
  return JSON.parse((result.content[0] as { text: string }).text) as Payload;
}

describe("arive_capabilities", () => {
  test("echoes the gateway instructions verbatim", () => {
    expect(call({}).instructions).toBe(INSTRUCTIONS);
  });

  test("reports live availability per namespace", () => {
    const payload = call({}, { lh: false });
    const byTool = new Map(
      payload.capabilities.map((entry) => [entry.tool, entry]),
    );
    expect(byTool.get("lh_start_run")?.available).toBe(false);
    expect(byTool.get("fable_judge")?.available).toBe(true);
    // A gateway tool has no namespace to ask, so it is always routable.
    expect(byTool.get("arive_guard")?.available).toBe(true);
    expect(payload.namespaces.lh?.usable).toBe(false);
  });

  test("filters by job substring across names and triggers", () => {
    const payload = call({ job: "JUDGE" });
    expect(payload.capabilities.map((entry) => entry.tool)).toEqual([
      "fable_judge",
    ]);
  });

  test("every advertised tool is one the gateway actually serves", () => {
    // A router naming a tool nobody implements is worse than no router.
    const listed = new Set(call({}).capabilities.map((entry) => entry.tool));
    for (const entry of ARIVE_CAPABILITIES) {
      expect(listed.has(entry.tool)).toBe(true);
      expect(entry.useWhen.length).toBeGreaterThan(0);
    }
  });

  test("stays out of the compression envelope", () => {
    const tool = createCapabilityTool({
      instructions: INSTRUCTIONS,
      summary: () => summary({}),
    });
    expect(tool.compressible).toBe(false);
  });
});
