import { expect, test, describe } from "bun:test";
import { PonytailFormatter } from "../src/explain/ponytail_formatter.js";

describe("Ponytail Formatter Tests", () => {
  test("Lite brevity level", () => {
    const input = "Please look at this. We literally just updated the configuration file.";
    const formatted = PonytailFormatter.format(input, "lite");
    expect(formatted).not.toContain("literally");
    expect(formatted).not.toContain("just");
  });

  test("Full brevity level (default)", () => {
    const input = "The server is running on the local port and it has successfully verified the results.";
    const formatted = PonytailFormatter.format(input, "full");
    expect(formatted).not.toContain("The");
    expect(formatted).not.toContain("is");
    expect(formatted).not.toContain("the");
    expect(formatted).not.toContain("has");
    expect(formatted).toContain("Server");
  });

  test("Ultra brevity level", () => {
    const input = "Run test suite. Task failed inside file tests/verify.test.ts at line number 24.";
    const formatted = PonytailFormatter.format(input, "ultra");
    expect(formatted).toContain("Run test. Task fail tests/verify.test.ts:24");
  });

  test("Normal brevity level", () => {
    const input = "Please look at this configuration file.";
    const formatted = PonytailFormatter.format(input, "normal");
    expect(formatted).toBe(input);
  });

  test("Savings calculation", () => {
    const original = "The server is running on the local port";
    const formatted = "Server running on local port";
    // original has 8 tokens, formatted has 5 tokens.
    // reduction = round((8 - 5) / 8 * 100) = round(37.5) = 38%
    const savings = PonytailFormatter.getSavings(original, formatted);
    expect(savings).toBe("38% token reduction (8 -> 5 tokens)");
  });
  test("Get instructions", () => {
    const instructions = PonytailFormatter.getInstructions("full");
    expect(instructions).toContain("PONYTAIL MODE ACTIVE");
    expect(instructions).toContain("YAGNI");
  });
});
