import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { TDDRunner } from "../src/verify/tdd_runner.js";
import { Validator } from "../src/verify/validator.js";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import * as fs from "fs";

describe("TDD & Verification Tests", () => {
  const statePath = ".arive/test_thinking_verify.db";

  beforeAll(() => {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  afterAll(() => {
    if (fs.existsSync(statePath)) {
      try {
        fs.unlinkSync(statePath);
      } catch {}
    }
  });

  test("Backprop reflex feedback loop integration", () => {
    const engine = new SequentialEngine(statePath);
    engine.addThought("Reason step", 1, 3, true);

    const failures = ["Test failure line 20"];
    Validator.backpropagate(engine, failures);

    const state = engine.getState();
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]).toBe("Test failure line 20");
    engine.close();
  });

  test("CCR hash verification using verifyHash", () => {
    const content = "Hello World Raw Content";
    const expectedHash =
      "ccr:937630995fc998f52ffe7a11052783202b01ec5c8a3fdfed83fa591acd7a15f8";

    expect(Validator.verifyHash(content, expectedHash)).toBe(true);
    expect(Validator.verifyHash(content + " mod", expectedHash)).toBe(false);
    expect(Validator.verifyHash(content, "invalid-prefix-hash")).toBe(false);
    expect(Validator.verifyHash(content, "")).toBe(false);
  });

  describe("Fail-Fast execution abort", () => {
    test("Aborts testing immediately when failure string is encountered", () => {
      const targetCwd = ".";
      // Using a command that outputs a failure string and exits non-zero
      const result = TDDRunner.run(
        targetCwd,
        "echo FAIL test abort error && exit 1",
      );
      expect(result.success).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0]).toContain("FAIL");
    });
  });
});
