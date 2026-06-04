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
    expect(Validator.verifyHash(content, "invalid-prefix-hash")).toBe(false);
    expect(Validator.verifyHash(content, "")).toBe(false);
  });

  test("TDDRunner parseFailures safety with long lines and huge output", () => {
    // 1. Check extremely long line handling
    const longLine = "A".repeat(5000) + " Error: Some long trace";
    const failures = TDDRunner.parseFailures(longLine);
    // Since it's > 2048 chars, we truncated it to 2048, meaning we might lose the "Error: Some long trace"
    // if it's placed at the very end. Let's make sure it handles it without crash.
    expect(failures).toBeArray();

    const longLineWithErrorAtStart = "Error: " + "B".repeat(5000);
    const failuresStart = TDDRunner.parseFailures(longLineWithErrorAtStart);
    expect(failuresStart.length).toBe(1);
    expect(failuresStart[0]).toContain("Error:");
    expect(failuresStart[0].length).toBe(2048);

    // 2. Check memory limits with massive output (1.5 MB string)
    const giantLog = ("Simple line\n").repeat(150000); // ~1.8 MB
    const parseGiant = TDDRunner.parseFailures(giantLog);
    expect(parseGiant).toBeArray();
  });

  test("TDDRunner run handles directory and execution exceptions gracefully", () => {
    // 1. Check Security Exception (outside allowed boundary)
    const resSec = TDDRunner.run("./invalid-outside-boundary-xyz", "bun test");
    expect(resSec.success).toBe(false);
    expect(resSec.failures.length).toBe(1);
    expect(resSec.failures[0]).toContain("Security Exception");
    expect(resSec.output).toContain("Runner Execution Failure");

    // 2. Check Directory Exception (inside worktrees but doesn't exist)
    const resDir = TDDRunner.run(".arive-worktrees/nonexistent-xyz", "bun test");
    expect(resDir.success).toBe(false);
    expect(resDir.failures.length).toBe(1);
    expect(resDir.failures[0]).toContain("Directory Exception");
    expect(resDir.output).toContain("Runner Execution Failure");
  });
});
