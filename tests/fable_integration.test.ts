import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import { HookManager } from "../src/integrate/hook_manager.js";
import * as fs from "fs";

describe("Fable Method Integration Tests", () => {
  const testDbPath = ".arive/test_fable_integration.db";
  let engine: SequentialEngine;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    engine = new SequentialEngine(testDbPath);
  });

  afterEach(() => {
    engine.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  test("SequentialEngine supports Fable ask classification and intent gate parsing", () => {
    expect(engine.classifyAsk("How do I configure MCP?")).toBe("question");
    expect(engine.classifyAsk("I need a plan to migrate DB")).toBe("plan-first");
    expect(engine.classifyAsk("Fix typo")).toBe("trivial");
    expect(engine.classifyAsk("Add user endpoint")).toBe("task");

    const intent = engine.parseIntentGate("INTENT: code does X / check expects Y / spec says Z");
    expect(intent?.code).toBe("X");
    expect(intent?.check).toBe("Y");
    expect(intent?.spec).toBe("Z");
  });

  test("SequentialEngine Fable-Judge adversarial verification", () => {
    const claims = ["All tests pass", "No memory leak"];
    const observations = [
      { check: "All tests pass", status: "passed" as const },
      { check: "No memory leak", status: "passed" as const },
    ];

    const verdict = engine.runFableJudge(claims, observations);
    expect(verdict.verdict).toBe("VERIFIED");
    expect(verdict.score).toBe(100);

    const refutationVerdict = engine.runFableJudge(
      ["All tests pass"],
      [{ check: "All tests pass", status: "failed" as const, details: "1 test failed" }]
    );
    expect(refutationVerdict.verdict).toBe("REFUTED");
  });

  test("Fable lifecycle hooks execute cleanly", () => {
    const preRes = HookManager.runHook("pre-reason", "reason", { thought: "INTENT: code does A / check expects B / spec says C" });
    expect(preRes.success).toBe(true);

    const postRes = HookManager.runHook("post-reason", "reason", { thoughtNumber: 1, totalThoughts: 1 });
    expect(postRes.success).toBe(true);

    const preVer = HookManager.runHook("pre-verify", "verify", { taskId: "test-task" });
    expect(preVer.success).toBe(true);

    const postVer = HookManager.runHook("post-verify", "verify", { success: true });
    expect(postVer.success).toBe(true);
  });
});
