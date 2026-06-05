import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import * as fs from "fs";

describe("Sequential Engine Tests", () => {
  const statePath = ".arive/test_thinking_state.json";

  beforeAll(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  afterAll(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  test("Thought tracking and branching", () => {
    const engine = new SequentialEngine(statePath);
    
    // Add thoughts
    engine.addThought("Hypothesis 1", 1, 3, true);
    engine.addThought("Hypothesis 2", 2, 3, true);
    
    let state = engine.getState();
    expect(state.history.length).toBe(2);
    expect(state.history[0].thought).toBe("Hypothesis 1");
    expect(state.history[1].status).toBe("active");

    // Backtrack
    engine.addThought("Revised Hyp 2", 2, 3, true, true, 1);
    
    state = engine.getState();
    // Index 1 (Hypothesis 2) should be backtracked
    expect(state.history[1].status).toBe("backtracked");
    expect(state.history[2].thought).toBe("Revised Hyp 2");
    expect(state.history[2].status).toBe("active");
  });

  test("Corrupted state file handling on load", () => {
    // Write invalid JSON to statePath
    fs.writeFileSync(statePath, "{ invalid json", "utf-8");
    
    // Engine should load safely and reset state
    const engine = new SequentialEngine(statePath);
    const state = engine.getState();
    expect(state.history.length).toBe(0);
    expect(state.activePlan).toBe("");
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]).toContain("Failed to load state");
  });

  test("Evaluates consensus scoring across virtual agent personas", () => {
    const engine = new SequentialEngine(statePath);
    engine.addThought("Verify implementation of sqlite integration checks", 1, 3, true);
    const debate = engine.evaluateConsensus();
    expect(debate.averageScore).toBeGreaterThanOrEqual(0);
    expect(debate.averageScore).toBeLessThanOrEqual(100);
    expect(debate.personas.length).toBe(3);
  });
});
