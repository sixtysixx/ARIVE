import { expect, test, describe } from "bun:test";
import { execSync } from "child_process";

describe("MCP Entrypoint Shell Run Tests", () => {
  test("TypeScript file compiles", () => {
    // Run TypeScript compiler check
    const compile = execSync("bun x tsc --noEmit", { encoding: "utf-8" });
    expect(compile).toBeDefined();
  });
});
