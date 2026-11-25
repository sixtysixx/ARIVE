import { describe, expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { JsonObject, LocalTool } from "../src/core/results.js";
import { createFableTools } from "../src/local/fable/index.js";

const tools = new Map<string, LocalTool>(
  createFableTools().map((tool) => [tool.name, tool]),
);

function call(name: string, args: JsonObject): unknown {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = tool.handler(args) as CallToolResult;
  const text = (result.content[0] as { text: string }).text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function text(name: string, args: JsonObject): string {
  return call(name, args) as string;
}

interface PlanResult {
  ok: boolean;
  missing: string[];
  stop: boolean;
  artifact: string;
}

interface JudgeResult {
  verdict: string;
  claims: Array<{ claim: string; result: string; evidence: string }>;
  findings: Array<{ fraud: string; detail?: string; files?: string[] }>;
  requiredReportLines: string[];
  action: string;
  checked: string;
}

describe("fable_method", () => {
  test("strips frontmatter and serves the loop", () => {
    const body = text("fable_method", {});
    expect(body).toContain("Step 0");
    expect(body.startsWith("fable-method v1.4.0 (MIT")).toBe(true);
    // The YAML block is display metadata, not rules.
    expect(body).not.toContain("description: A step-by-step");
  });

  test("loads each deep reference", () => {
    expect(text("fable_method", { mode: "examples" })).toContain(
      "Worked examples: one per ask shape",
    );
    expect(text("fable_method", { mode: "failure-modes" })).toContain(
      "Eighteen ways agentic work goes wrong",
    );
    expect(text("fable_method", { mode: "flowcharts" })).toContain(
      "The workflow, drawn",
    );
  });

  test("appends a domain adapter", () => {
    const body = text("fable_method", { mode: "method", domain: "devops" });
    expect(body).toContain("# Domain adapter: devops");
  });

  test("rejects an unknown domain and an unknown mode", () => {
    expect(() => call("fable_method", { domain: "gardening" })).toThrow(
      /Known adapters/,
    );
    expect(() => call("fable_method", { mode: "rumor" })).toThrow(
      /mode must be one of/,
    );
  });
});

describe("fable_plan", () => {
  const complete = {
    classification: "plan-first",
    task: "Add a retry to the uploader",
    done: "A failed upload retries three times and reports the last error.",
    verification: "bun test tests/upload.test.ts",
    evidence: [{ source: "src/upload.ts:41", finding: "no retry exists" }],
    recommendation: "Wrap the POST in a bounded retry",
    alternatives: [{ option: "Queue to disk", whyRejected: "no queue infra" }],
    scope: ["src/upload.ts"],
    assumptions: ["the server is idempotent"],
  };

  test("a task without a verification reports the gap and still renders", () => {
    const plan = call("fable_plan", {
      classification: "task",
      task: "Bump the cache header",
      done: "Clients see max-age=60",
      recommendation: "Set the header in the CDN config",
    }) as PlanResult;
    expect(plan.ok).toBe(false);
    expect(plan.missing).toContain("verification");
    expect(plan.artifact).toContain("## Checklist");
    expect(plan.artifact).toContain("Verify: not named");
  });

  test("plan-first without scope stops for approval", () => {
    const plan = call("fable_plan", {
      classification: "plan-first",
      task: "Migrate the store",
      done: "Reads and writes land in the new table",
      verification: "row counts match",
      recommendation: "Dual-write, then swap reads",
    }) as PlanResult;
    expect(plan.missing).toContain("scope");
    expect(plan.stop).toBe(true);
    expect(plan.artifact).toContain("Stop here");
  });

  test("a complete plan-first input is valid", () => {
    const plan = call("fable_plan", complete) as PlanResult;
    expect(plan.ok).toBe(true);
    expect(plan.missing).toEqual([]);
    expect(plan.artifact).toContain("# Plan: Add a retry to the uploader");
    expect(plan.artifact).toContain("- src/upload.ts:41: no retry exists");
    expect(plan.artifact).toContain(
      "- Queue to disk — rejected: no queue infra",
    );
    expect(plan.artifact).toContain("- [ ] src/upload.ts");
  });

  test("a question changes nothing", () => {
    const plan = call("fable_plan", {
      classification: "question",
      task: "Why is the dashboard slow?",
      done: "One cause backed by measurements",
    }) as PlanResult;
    expect(plan.ok).toBe(true);
    expect(plan.artifact).toContain("Change nothing");
  });

  test("evidence entries need both fields", () => {
    expect(() =>
      call("fable_plan", {
        classification: "task",
        task: "t",
        done: "d",
        evidence: [{ source: "src/a.ts" }],
      }),
    ).toThrow(/evidence\[0\] needs source and finding/);
  });

  test("rejects an unknown classification", () => {
    expect(() =>
      call("fable_plan", { classification: "vibe", task: "t", done: "d" }),
    ).toThrow(/classification must be one of/);
  });
});

describe("fable_judge", () => {
  test("all confirmed claims verify", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "tests pass", result: "confirmed", evidence: "42 pass" }],
    }) as JudgeResult;
    expect(judge.verdict).toBe("VERIFIED");
    expect(judge.findings).toEqual([]);
    expect(judge.requiredReportLines).toEqual([]);
    expect(judge.action).toContain("ship");
    expect(judge.checked).toContain("executed nothing");
  });

  test("an unverified claim is a caveat", () => {
    const judge = call("fable_judge", {
      claims: [
        { claim: "tests pass", result: "confirmed", evidence: "42 pass" },
        { claim: "the UI renders" },
      ],
    }) as JudgeResult;
    expect(judge.verdict).toBe("VERIFIED WITH CAVEATS");
    expect(judge.findings[0]?.fraud).toBe("unverifiable");
    // An omitted result defaults to unverified rather than to a pass.
    expect(judge.claims[1]?.result).toBe("unverified");
  });

  test("a contradicted claim refutes the work", () => {
    const judge = call("fable_judge", {
      claims: [
        { claim: "tests pass", result: "contradicted", evidence: "1 failing" },
      ],
    }) as JudgeResult;
    expect(judge.verdict).toBe("REFUTED");
    expect(judge.findings[0]?.fraud).toBe("refuted-claim");
    expect(judge.findings[0]?.detail).toBe("tests pass: 1 failing");
    expect(judge.action).toContain("fix:");
  });

  test("a contradicted claim without evidence still names the claim", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "build is clean", result: "contradicted" }],
    }) as JudgeResult;
    expect(judge.findings[0]?.detail).toBe("build is clean: no evidence given");
  });

  test("editing a test file is a weakened check", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "suite passes", result: "confirmed", evidence: "ok" }],
      changedFiles: ["tests/a.test.ts"],
    }) as JudgeResult;
    expect(judge.verdict).toBe("VERIFIED WITH CAVEATS");
    expect(judge.findings[0]).toEqual({
      fraud: "weakened-check",
      files: ["tests/a.test.ts"],
    });
  });

  test("a file outside the declared scope is scope creep", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "done", result: "confirmed", evidence: "ok" }],
      changedFiles: ["src/a.ts", "README.md"],
      declaredScope: ["src/a.ts"],
    }) as JudgeResult;
    expect(judge.findings[0]).toEqual({
      fraud: "scope-creep",
      files: ["README.md"],
    });
  });

  test("an outward action without authorization refutes", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "deployed", result: "confirmed", evidence: "pushed" }],
      outwardActions: [{ action: "deploy" }],
    }) as JudgeResult;
    expect(judge.verdict).toBe("REFUTED");
    expect(judge.findings[0]).toEqual({
      fraud: "unauthorized-action",
      detail: "deploy",
    });
  });

  test("debris files are flagged and windows paths are normalized", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "done", result: "confirmed", evidence: "ok" }],
      changedFiles: ["src\\a.ts", "src/scratch_debug.py"],
      declaredScope: ["src"],
    }) as JudgeResult;
    expect(judge.findings).toHaveLength(1);
    expect(judge.findings[0]?.fraud).toBe("debris");
    expect(judge.findings[0]?.files).toEqual(["src/scratch_debug.py"]);
  });

  test("requires the report lines the method mandates", () => {
    const judge = call("fable_judge", {
      claims: [{ claim: "fixed", result: "confirmed", evidence: "test green" }],
      outwardActions: [{ action: "deploy", authQuote: "ship it" }],
      report: {
        behaviorChanged: true,
        fixedDefect: true,
        pendingFollowUp: "rotate the key",
      },
    }) as JudgeResult;
    expect(judge.requiredReportLines).toEqual([
      "INTENT: code does <X>; the failing check/task expects <Y>; the spec says <Z>",
      'AUTH: user said "ship it"',
      'TWINS: searched <pattern> - found <N> other sites: <files, or "none">',
      "PENDING: rotate the key - awaiting your authorization",
    ]);
    expect(judge.verdict).toBe("VERIFIED");
  });

  test("rejects empty claims and an unknown result", () => {
    expect(() => call("fable_judge", { claims: [] })).toThrow(
      /claims must be a non-empty array/,
    );
    expect(() =>
      call("fable_judge", {
        claims: [{ claim: "x", result: "probably" }],
      }),
    ).toThrow(/result must be confirmed, unverified, or contradicted/);
  });

  test("every fable tool opts out of compression", () => {
    for (const tool of createFableTools()) {
      expect(tool.compressible).toBe(false);
    }
  });
});
