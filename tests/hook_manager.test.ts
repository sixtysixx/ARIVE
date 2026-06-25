import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { HookManager } from "../src/integrate/hook_manager.js";
import * as fs from "fs";
import * as path from "path";

describe("HookManager", () => {
  const hooksDir = path.resolve(".arive", "hooks");
  const testHookPath = path.join(hooksDir, "pre-test-success.js");
  const failHookPath = path.join(hooksDir, "pre-test-fail.js");
  const envHookPath = path.join(hooksDir, "pre-test-env.js");

  beforeAll(() => {
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up created test hook files
    [testHookPath, failHookPath, envHookPath].forEach((p) => {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // Ignore
        }
      }
    });
  });

  test("returns success: true when hooks folder or file does not exist", () => {
    const res = HookManager.runHook(
      "pre-non-existent-hook-name",
      "test-phase",
      { data: "test" },
    );
    expect(res.success).toBe(true);
  });

  test("runs JS hook script successfully", () => {
    fs.writeFileSync(
      testHookPath,
      `console.log("Success Hook Executed");\nprocess.exit(0);\n`,
      "utf-8",
    );

    const res = HookManager.runHook("pre-test-success", "test-phase", {
      data: "foo",
    });
    expect(res.success).toBe(true);
  });

  test("handles hook script exit code non-zero failures", () => {
    fs.writeFileSync(
      failHookPath,
      `console.error("Hook Failed Intentionally");\nprocess.exit(1);\n`,
      "utf-8",
    );

    const res = HookManager.runHook("pre-test-fail", "test-phase", {
      data: "bar",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("Hook exited with code 1");
    expect(res.error).toContain("Hook Failed Intentionally");
  });

  test("passes correct environment variables to the hook script", () => {
    fs.writeFileSync(
      envHookPath,
      `
      const name = process.env.ARIVE_HOOK_NAME;
      const phase = process.env.ARIVE_HOOK_PHASE;
      const context = JSON.parse(process.env.ARIVE_HOOK_CONTEXT || "{}");
      const result = JSON.parse(process.env.ARIVE_HOOK_RESULT || "{}");

      if (name !== "pre-test-env") {
        console.error("Wrong hook name: " + name);
        process.exit(2);
      }
      if (phase !== "test-phase") {
        console.error("Wrong hook phase: " + phase);
        process.exit(3);
      }
      if (context.key !== "val") {
        console.error("Wrong hook context key: " + context.key);
        process.exit(4);
      }
      if (result.status !== "ok") {
        console.error("Wrong hook result status: " + result.status);
        process.exit(5);
      }

      console.log("Environment verification passed!");
      process.exit(0);
      `,
      "utf-8",
    );

    const res = HookManager.runHook(
      "pre-test-env",
      "test-phase",
      { key: "val" },
      { status: "ok" },
    );
    expect(res.success).toBe(true);
  });
});
