import { describe, expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mergeConfig } from "../src/core/config.js";
import { runCommand } from "../src/core/exec.js";
import { HookEngine } from "../src/core/hooks.js";

// ast-grep is an optional dependency: without it the rules degrade, which the
// engine's own tests cover. CI does not install it, so this suite skips there.
// spawnSync throws instead of returning a code when the binary is absent.
function astGrepAvailable(): boolean {
  try {
    return Bun.spawnSync(["sg", "--version"]).exitCode === 0;
  } catch {
    return false;
  }
}

const hasSg = astGrepAvailable();

const NO_REQUIRE = {
  id: "no-require",
  scope: "args",
  astCondition: { pattern: "require($M)", lang: "ts" },
  guidance: "Use ESM import instead.",
};

function engine(rawHooks: unknown, deps?: { run?: typeof runCommand }): HookEngine {
  return new HookEngine(mergeConfig({ hooks: rawHooks }).hooks, deps);
}

describe.skipIf(!hasSg)("ast-grep conditions", () => {
  test("blocks a call whose code matches the pattern", async () => {
    const hooks = engine({ guards: [NO_REQUIRE] });
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.violations[0]!.rule).toBe("no-require");
    expect(outcome.violations[0]!.match).toContain("require");
    expect(outcome.degraded).toEqual([]);
    expect(hooks.stats().astChecks).toBe(1);
  }, 20_000);

  test("passes code that does not match", async () => {
    const hooks = engine({ guards: [NO_REQUIRE] });
    const outcome = await hooks.checkCall("lsp_edit", {
      code: "import fs from 'fs';",
    });

    expect(outcome.blocked).toBe(false);
    expect(outcome.violations).toEqual([]);
    expect(outcome.degraded).toEqual([]);
  }, 20_000);

  test("only parses string arguments", async () => {
    const hooks = engine({ guards: [NO_REQUIRE] });
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 42,
      flags: ["require"],
    });
    expect(outcome.blocked).toBe(false);
    // Nothing was parseable, so no process was spawned.
    expect(hooks.stats().astChecks).toBe(0);
  }, 20_000);

  test("degrades an unusable pattern instead of passing silently", async () => {
    const skip = engine({
      guards: [{ ...NO_REQUIRE, id: "bad", astCondition: { pattern: "require(", lang: "ts" } }],
    });
    const skipped = await skip.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });
    expect(skipped.blocked).toBe(false);
    expect(skipped.degraded.length).toBeGreaterThan(0);
    expect(skipped.degraded[0]).toContain("ast-grep failed for guard rule \"bad\"");
    expect(skip.stats().astErrors).toBe(1);

    const blocked = engine({
      onAstError: "block",
      guards: [{ ...NO_REQUIRE, id: "bad", astCondition: { pattern: "require(", lang: "ts" } }],
    });
    const closed = await blocked.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });
    expect(closed.blocked).toBe(true);
    expect(closed.violations[0]!.guidance).toContain("could not be evaluated");
  }, 20_000);

  test("skips an argument larger than the scan window", async () => {
    const hooks = engine({
      maxScanChars: 50,
      guards: [{ ...NO_REQUIRE, id: "big" }],
    });
    const outcome = await hooks.checkCall("lsp_edit", {
      code: `require("fs");${"//".repeat(60)}`,
    });
    expect(outcome.blocked).toBe(false);
    expect(outcome.degraded[0]).toContain("exceeds hooks.maxScanChars");
    expect(hooks.stats().astChecks).toBe(0);
  }, 20_000);

  test("runs one process for two rules with the same pattern", async () => {
    let calls = 0;
    const fakeRun: typeof runCommand = async () => {
      calls += 1;
      return {
        code: 0,
        stdout: "[]",
        stderr: "",
        timedOut: false,
        truncated: false,
        stopped: false,
        signal: null,
      };
    };
    const hooks = engine(
      {
        guards: [
          NO_REQUIRE,
          { ...NO_REQUIRE, id: "no-require-too", guidance: "Really: use ESM." },
        ],
      },
      { run: fakeRun },
    );
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });

    expect(calls).toBe(1);
    expect(outcome.violations).toEqual([]);
    expect(hooks.stats().astChecks).toBe(1);
  });
});

describe("ast-grep absence", () => {
  test("reports a missing binary when the runner cannot spawn it", async () => {
    const hooks = engine(
      { guards: [NO_REQUIRE] },
      {
        run: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          stopped: false,
          signal: null,
        }),
      },
    );
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });
    expect(outcome.blocked).toBe(false);
    expect(outcome.degraded[0]).toContain("is not runnable");
  });

  test("reports a timeout rather than treating it as a pass", async () => {
    const hooks = engine(
      { astTimeoutMs: 1234, guards: [NO_REQUIRE] },
      {
        run: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          truncated: false,
          stopped: false,
          signal: "SIGKILL",
        }),
      },
    );
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });
    expect(outcome.degraded[0]).toBe(
      'ast-grep timed out after 1234ms for guard rule "no-require"',
    );
  });
});

function texts(out: CallToolResult): string[] {
  return out.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text);
}

describe("degraded evaluations", () => {
  test("annotates a degraded evaluation on the success path", async () => {
    // An empty result array plus a pattern warning is what `sg` reports for an
    // unusable pattern: no match, and nothing actually evaluated.
    const hooks = engine(
      {
        guards: [
          { ...NO_REQUIRE, id: "bad", astCondition: { pattern: "require(", lang: "ts" } },
        ],
      },
      {
        run: async () => ({
          code: 0,
          stdout: "[]",
          stderr: "Warning: pattern is invalid: ERROR node in AST",
          timedOut: false,
          truncated: false,
          stopped: false,
          signal: null,
        }),
      },
    );
    const outcome = await hooks.checkCall("lsp_edit", {
      code: 'const fs = require("fs");',
    });
    expect(outcome.violations).toEqual([]);
    expect(outcome.degraded.length).toBeGreaterThan(0);

    const annotated = hooks.annotate("lsp_edit", { content: [] }, outcome);
    const body = texts(annotated);
    expect(body.at(-1)).toContain('<arive-hook degraded="true">');
    expect(body.at(-1)).toContain('ast-grep failed for guard rule "bad"');
  }, 20_000);

  test("checkText degrades instead of truncating silently", async () => {
    const hooks = engine({
      maxScanChars: 50,
      guards: [{ ...NO_REQUIRE, id: "bad-text", scope: "text" }],
    });
    const outcome = await hooks.checkText(`require("fs");${"//".repeat(200)}`);

    expect(outcome.blocked).toBe(false);
    expect(outcome.degraded[0]).toContain("exceeds hooks.maxScanChars");
    // The prefix was never handed to `sg`, so nothing was evaluated.
    expect(hooks.stats().astChecks).toBe(0);
  }, 20_000);
});
