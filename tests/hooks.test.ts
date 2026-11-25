import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defaultConfig, loadConfig, mergeConfig } from "../src/core/config.js";
import { blockedResult, HookEngine, type HookOutcome } from "../src/core/hooks.js";

function engine(rawHooks: unknown): HookEngine {
  return new HookEngine(mergeConfig({ hooks: rawHooks }).hooks);
}

function result(text = "body"): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function texts(out: CallToolResult): string[] {
  return out.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text);
}

const NO_RM = {
  id: "no-rm",
  scope: "args",
  tool: "^search_",
  condition: "rm\\s+-rf",
  guidance: "Never delete recursively.",
};

describe("HookEngine argument guards", () => {
  test("blocks a call whose arguments match a rule", async () => {
    const hooks = engine({ guards: [NO_RM] });
    const outcome = await hooks.checkCall("search_query", {
      pattern: "rm -rf /",
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]!.rule).toBe("no-rm");
    expect(outcome.violations[0]!.match).toBe("rm -rf");
    expect(outcome.scannedChars).toBeGreaterThan(0);
  });

  test("rules only see the tools their tool pattern names", async () => {
    const hooks = engine({ guards: [NO_RM] });
    const outcome = await hooks.checkCall("rag_query", { pattern: "rm -rf /" });
    expect(outcome.blocked).toBe(false);
    expect(outcome.violations).toEqual([]);
  });

  test("a text-scope rule is ignored by the call check", async () => {
    const hooks = engine({
      guards: [{ ...NO_RM, id: "text-rm", scope: "text", tool: undefined }],
    });
    expect((await hooks.checkCall("search_query", { pattern: "rm -rf /" }))
      .blocked).toBe(false);
    expect((await hooks.checkText("please rm -rf /")).blocked).toBe(true);
  });

  test("warn rules report without blocking and annotate the result", async () => {
    const hooks = engine({
      guards: [{ ...NO_RM, action: "warn", guidance: "Prefer a scoped path." }],
      docs: [],
    });
    const outcome = await hooks.checkCall("search_query", {
      pattern: "rm -rf /",
    });
    expect(outcome.blocked).toBe(false);
    expect(outcome.violations[0]!.action).toBe("warn");

    const annotated = hooks.annotate("search_query", result(), outcome);
    const body = texts(annotated);
    expect(body).toHaveLength(2);
    expect(body[1]).toContain('<arive-hook rule="no-rm">');
    expect(body[1]).toContain("Prefer a scoped path.");
  });

  test("disabled hooks evaluate nothing", async () => {
    const hooks = engine({ enabled: false, guards: [NO_RM] });
    const outcome = await hooks.checkCall("search_query", {
      pattern: "rm -rf /",
    });
    expect(outcome).toEqual({
      violations: [],
      blocked: false,
      degraded: [],
      scannedChars: 0,
    });
    // Annotation is part of the same switch.
    const input = result();
    expect(hooks.annotate("search_query", input, outcome)).toBe(input);
  });

  test("counters count outcomes, not rules", async () => {
    const hooks = engine({
      guards: [
        NO_RM,
        { ...NO_RM, id: "no-rm-2" },
        { ...NO_RM, id: "no-rm-warn", action: "warn" },
      ],
    });
    await hooks.checkCall("search_query", { pattern: "rm -rf /" });
    await hooks.checkCall("search_query", { pattern: "harmless" });
    const stats = hooks.stats();
    expect(stats.checks).toBe(2);
    expect(stats.blocked).toBe(1);
    expect(stats.warned).toBe(0);
    expect(stats.guards).toBe(3);
  });

  test("a match is capped instead of echoing the payload", async () => {
    const hooks = engine({
      guards: [{ ...NO_RM, id: "long", tool: undefined, condition: "z+" }],
    });
    const outcome = await hooks.checkCall("search_query", {
      pattern: "z".repeat(500),
    });
    expect(outcome.violations[0]!.match.length).toBe(200);
  });
});

describe("HookEngine docs", () => {
  test("annotates a matching tool with its doc block", () => {
    const hooks = engine({
      docs: [
        {
          id: "ts-strict",
          tool: "^lsp_diagnostics$",
          title: "Strict mode",
          text: "The project builds with strict: true.",
        },
      ],
    });
    const annotated = hooks.annotate("lsp_diagnostics", result());
    const body = texts(annotated);
    expect(body[1]).toContain('<arive-doc id="ts-strict" title="Strict mode">');
    expect(body[1]).toContain("strict: true");
  });

  test("returns the same object when nothing matches", () => {
    const hooks = engine({
      docs: [{ id: "ts-strict", tool: "^lsp_", text: "strict" }],
    });
    const input = result();
    expect(hooks.annotate("search_query", input)).toBe(input);
  });

  test("does not annotate a failed call", () => {
    const hooks = engine({
      docs: [{ id: "ts-strict", tool: "^lsp_", text: "strict" }],
    });
    const failure: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    expect(hooks.annotate("lsp_diagnostics", failure)).toBe(failure);
  });

  test("a once doc is injected once and a plain doc every time", () => {
    const hooks = engine({
      docs: [
        { id: "awareness", tool: ".", text: "capabilities", once: true },
        { id: "always", tool: ".", text: "every call" },
      ],
    });

    const first = texts(hooks.annotate("search_query", result()));
    expect(first).toHaveLength(3);
    expect(first[1]).toContain('<arive-doc id="awareness"');
    expect(first[2]).toContain('<arive-doc id="always"');

    const second = texts(hooks.annotate("search_query", result()));
    expect(second).toHaveLength(2);
    expect(second.join("\n")).not.toContain('id="awareness"');
    expect(second[1]).toContain('<arive-doc id="always"');
  });

  test("a skipped matching tool does not consume the one shot", () => {
    const hooks = engine({
      docs: [{ id: "judge", tool: "^lsp_", text: "verify", once: true }],
    });
    // The name does not match, so nothing is spent.
    expect(hooks.annotate("search_query", result())).toEqual(result());
    const first = texts(hooks.annotate("lsp_diagnostics", result()));
    expect(first[1]).toContain('id="judge"');
    expect(texts(hooks.annotate("lsp_diagnostics", result()))).toHaveLength(1);
  });
});

describe("hook configuration", () => {
  test("rejects a condition that is not a regular expression", () => {
    expect(() =>
      mergeConfig({
        hooks: {
          guards: [{ id: "x", scope: "args", condition: "(", guidance: "g" }],
        },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
  });

  test("rejects a rule with no condition at all", () => {
    expect(() =>
      mergeConfig({
        hooks: { guards: [{ id: "x", scope: "args", guidance: "g" }] },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
  });

  test("rejects an empty guidance and a bad id", () => {
    expect(() =>
      mergeConfig({
        hooks: {
          guards: [{ id: "x", condition: "a", guidance: "" }],
        },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
    expect(() =>
      mergeConfig({
        hooks: {
          guards: [{ id: "not an id", condition: "a", guidance: "g" }],
        },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
  });

  test("rejects unknown scope and action values", () => {
    expect(() =>
      mergeConfig({
        hooks: {
          guards: [{ id: "x", scope: "code", condition: "a", guidance: "g" }],
        },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
    expect(() =>
      mergeConfig({
        hooks: {
          guards: [{ id: "x", action: "maybe", condition: "a", guidance: "g" }],
        },
      }),
    ).toThrow(/Invalid hooks\.guards\[0\]/);
  });

  test("rejects a doc longer than the cap and a bad doc tool pattern", () => {
    expect(() =>
      mergeConfig({
        hooks: { docs: [{ id: "d", tool: "^x$", text: "t".repeat(8001) }] },
      }),
    ).toThrow(/Invalid hooks\.docs\[0\]/);
    expect(() =>
      mergeConfig({ hooks: { docs: [{ id: "d", tool: "(", text: "t" }] } }),
    ).toThrow(/Invalid hooks\.docs\[0\]/);
  });

  test("accepts a fully specified rule and applies defaults otherwise", () => {
    const config = mergeConfig({
      hooks: {
        guards: [
          {
            id: "no-secrets",
            description: "No literal credentials",
            tool: "^search_",
            condition: "AKIA",
            guidance: "Reference secrets by name.",
          },
        ],
        docs: [{ id: "d", tool: "^mem_", text: "Memory is idempotent." }],
      },
    });
    expect(config.hooks.guards[0]).toMatchObject({
      id: "no-secrets",
      scope: "args",
      action: "block",
    });
    expect(config.hooks.docs).toHaveLength(1);
    // Untouched scalars keep their defaults.
    expect(config.hooks.maxScanChars).toBe(20_000);
    expect(config.hooks.onAstError).toBe("skip");
  });

  test("keeps once on a configured doc and rejects a non-boolean", () => {
    const config = mergeConfig({
      hooks: { docs: [{ id: "d", tool: "^x$", text: "t", once: true }] },
    });
    expect(config.hooks.docs[0]!.once).toBe(true);
    expect(() =>
      mergeConfig({
        hooks: { docs: [{ id: "d", tool: "^x$", text: "t", once: "yes" }] },
      }),
    ).toThrow(/Invalid hooks\.docs\[0\]/);
  });

  test("ships an awareness doc and a run-driving doc by default", () => {
    const docs = defaultConfig().hooks.docs;
    const awareness = docs.find((doc) => doc.id === "arive-awareness");
    expect(awareness?.once).toBe(true);
    expect(awareness?.text).toContain("arive_capabilities");
    const driver = docs.find((doc) => doc.id === "lh-driver");
    expect(driver?.tool).toBe("^lh_start_run$");
    expect(driver?.text).toContain("lh_run_status");
  });

  test("validation rejects a scan window that would disable every rule", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-hooks-"));
    const file = path.join(dir, "arive.config.json");
    try {
      fs.writeFileSync(file, JSON.stringify({ hooks: { maxScanChars: 0 } }));
      expect(() => loadConfig(file)).toThrow(/hooks\.maxScanChars/);
      fs.writeFileSync(file, JSON.stringify({ hooks: { astTimeoutMs: 0 } }));
      expect(() => loadConfig(file)).toThrow(/hooks\.astTimeoutMs/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("blockedResult", () => {
  test("serializes the block, the rule list, and the reminder", async () => {
    const hooks = engine({
      guards: [{ ...NO_RM, guidance: "Never delete recursively." }],
    });
    const outcome = await hooks.checkCall("search_query", {
      pattern: "rm -rf /",
    });
    const blocked = blockedResult(outcome);

    expect(blocked.isError).toBe(true);
    expect(blocked.content).toHaveLength(2);
    const payload = JSON.parse(texts(blocked)[0]!) as Record<string, unknown>;
    expect(payload.rule).toBe("no-rm");
    expect(payload.executed).toBe(false);
    expect(payload.retry).toBe(true);
    expect(payload.degraded).toBeUndefined();
    expect(texts(blocked)[1]!.startsWith("<system-reminder>")).toBe(true);
    expect(texts(blocked)[1]).toContain("Never delete recursively.");
  });

  test("reports degraded conditions alongside the block", () => {
    const outcome: HookOutcome = {
      violations: [
        {
          rule: "ast-only",
          action: "block",
          guidance: "Not evaluable.",
          match: "",
        },
      ],
      blocked: true,
      degraded: ["sg missing"],
      scannedChars: 0,
    };
    const payload = JSON.parse(texts(blockedResult(outcome))[0]!) as Record<
      string,
      unknown
    >;
    expect(payload.degraded).toEqual(["sg missing"]);
  });
});
