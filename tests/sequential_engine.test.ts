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
});
