import { expect, test, describe } from "bun:test";
import { LithicFormatter } from "../src/explain/lithic_formatter.js";

describe("Lithic Formatter Tests", () => {
  test("Lite brevity level", () => {
    const input = "Please look at this. We literally just updated the configuration file.";
    const formatted = LithicFormatter.format(input, "lite");
    expect(formatted).not.toContain("literally");
    expect(formatted).not.toContain("just");
  });

  test("Full brevity level (default)", () => {
    const input = "The server is running on the local port and it has successfully verified the results.";
    const formatted = LithicFormatter.format(input, "full");
    expect(formatted).not.toContain("The");
    expect(formatted).not.toContain("is");
    expect(formatted).not.toContain("the");
    expect(formatted).not.toContain("has");
    expect(formatted).toContain("Server");
  });

  test("Ultra brevity level", () => {
    const input = "Run test suite. Task failed inside file tests/verify.test.ts at line number 24.";
    const formatted = LithicFormatter.format(input, "ultra");
    expect(formatted).toContain("Run test. Task fail tests/verify.test.ts:24");
  });
});
