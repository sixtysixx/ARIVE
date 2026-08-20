import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { SequentialEngine, Thought } from "../src/reason/sequential_engine.js";
import * as fs from "fs";
import * as path from "path";

describe("Sequential Engine Tests", () => {
  const statePath = ".arive/test_thinking_state.db";
  let engine: SequentialEngine;

  beforeEach(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    engine = new SequentialEngine(statePath);
  });

  afterEach(() => {
    engine.close();
    if (fs.existsSync(statePath)) {
      try {
        fs.unlinkSync(statePath);
      } catch {}
    }
  });

  test("Thought tracking and branching", () => {
    engine.addThought("Initial thought", 1, 3, true);
    engine.addThought("Second thought", 2, 3, true);

    let state = engine.getState();
    expect(state.history.length).toBe(2);
    expect(state.history[0].thought).toBe("Initial thought");
    expect(state.history[1].status).toBe("active");

    // Revision: revise thought 1 (backtracks all after 1)
    engine.addThought("Revised thought 2", 2, 3, false, true, 1);
    state = engine.getState();

    expect(state.history.length).toBe(3);
    // Original thought 2 should be backtracked
    const t2 = state.history.find(
      (t: Thought) => t.thought === "Second thought",
    );
    expect(t2?.status).toBe("backtracked");

    const rev2 = state.history.find(
      (t: Thought) => t.thought === "Revised thought 2",
    );
    expect(rev2?.status).toBe("active");
  });

  test("Evaluates consensus scoring across virtual agent personas", () => {
    engine.addThought(
      "We should implement a robust verification loop using bun test and verify all edge cases.",
      1,
      1,
      false,
    );
    const report = engine.evaluateConsensus();

    expect(report.averageScore).toBeGreaterThan(60);
    expect(report.personas.length).toBe(4);
    expect(report.personas[0].role).toBe("Developer");
    expect(report.personas[3].role).toBe("FableJudge");
  });

  test("Fable Method extensions: classifyAsk, parseIntentGate, defineDone, runFableJudge", () => {
    expect(engine.classifyAsk("Please provide a plan to refactor database")).toBe("plan-first");
    expect(engine.classifyAsk("Why is the transport closing?")).toBe("question");
    expect(engine.classifyAsk("Fix typo in README")).toBe("trivial");
    expect(engine.classifyAsk("Implement new authentication endpoint")).toBe("task");

    const intent = engine.parseIntentGate("INTENT: code does X / check expects Y / spec says Z");
    expect(intent).not.toBeNull();
    expect(intent?.code).toBe("X");
    expect(intent?.check).toBe("Y");
    expect(intent?.spec).toBe("Z");

    engine.defineDone("bun test");
    engine.addThought("INTENT: code does old logic / check expects new return / spec says new behavior", 1, 1, false);

    let state = engine.getState();
    expect(state.definedDone).toBe("bun test");
    expect(state.intents?.length).toBe(1);

    const judgeVerdict = engine.runFableJudge(
      ["All unit tests pass"],
      [{ check: "All unit tests pass", status: "passed" }]
    );
    expect(judgeVerdict.verdict).toBe("VERIFIED");
    expect(judgeVerdict.score).toBe(100);

    const report = engine.evaluateConsensus();
    expect(report.fableVerdict?.verdict).toBe("VERIFIED");
  });
});
