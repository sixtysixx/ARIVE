import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
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
    const t2 = state.history.find((t: Thought) => t.thought === "Second thought");
    expect(t2?.status).toBe("backtracked");
    
    const rev2 = state.history.find((t: Thought) => t.thought === "Revised thought 2");
    expect(rev2?.status).toBe("active");
  });

  test("Evaluates consensus scoring across virtual agent personas", () => {
    engine.addThought("We should implement a robust verification loop using bun test and verify all edge cases.", 1, 1, false);
    const report = engine.evaluateConsensus();
    
    expect(report.averageScore).toBeGreaterThan(60);
    expect(report.personas.length).toBe(3);
    expect(report.personas[0].role).toBe("Developer");
  });
});
