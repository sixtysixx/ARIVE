import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { TDDRunner } from "../src/verify/tdd_runner.js";
import { Validator } from "../src/verify/validator.js";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import * as fs from "fs";

describe("TDD & Verification Tests", () => {
  const statePath = ".arive/test_thinking_verify.json";

  beforeAll(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  afterAll(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  test("TDD error parsing logic", () => {
    const errorContent = `
      FAIL tests/test.ts
      Error: Expected 'foo' to be 'bar'
      at Object.<anonymous> (tests/test.ts:10:12)
    `;
    const failures = TDDRunner.parseFailures(errorContent);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("Expected 'foo'");
  });

  test("Backprop reflex feedback loop integration", () => {
    const engine = new SequentialEngine(statePath);
    engine.addThought("Reason step", 1, 3, true);

    const failures = ["Test failure line 20"];
    Validator.backpropagate(engine, failures);

    const state = engine.getState();
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]).toBe("Test failure line 20");
  });

  test("CCR hash verification using verifyHash", () => {
    const content = "Hello World Raw Content";
    const expectedHash = "ccr:937630995fc998f52ffe7a11052783202b01ec5c8a3fdfed83fa591acd7a15f8";
    
    expect(Validator.verifyHash(content, expectedHash)).toBe(true);
    expect(Validator.verifyHash(content + " mod", expectedHash)).toBe(false);
  });
});
