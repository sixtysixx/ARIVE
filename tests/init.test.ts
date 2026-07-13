import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as os from "os";
import { writeHookFileWithConflict } from "../src/cli/init_hooks.js";
import * as fs from "fs";

test("Project configurations exist", () => {
  expect(fs.existsSync("package.json")).toBe(true);
  expect(fs.existsSync("tsconfig.json")).toBe(true);
});

test("Advanced prompt generator outputs prompt content", () => {
  let output = "";
  const originalLog = console.log;
  console.log = (msg: string) => {
    output = msg;
  };
  
  const { outputAdvancedPrompt } = require("../src/cli/prompt_generator.js");
  outputAdvancedPrompt();
  
  console.log = originalLog;
  
  expect(output).toContain("ARIVE ADVANCED FRONTIER MODEL ORCHESTRATION PROMPT");
  expect(output).toContain("FIVE-PHASE REASONING & INTEGRITY PROTOCOL");
});

describe("writeHookFileWithConflict", () => {
  let tempDir: string;
  let hookFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-test-"));
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  beforeEach(() => {
    hookFile = path.join(tempDir, `hook-${Math.random()}`);
  });

  afterEach(() => {
    if (fs.existsSync(hookFile)) {
      fs.unlinkSync(hookFile);
    }
  });

  test("writes hook when file does not exist", () => {
    writeHookFileWithConflict(hookFile, "skip");
    expect(fs.existsSync(hookFile)).toBe(true);
    expect(fs.readFileSync(hookFile, "utf-8")).toContain("ARIVE pre-commit");
  });

  test("overwrites hook when file exists and action is overwrite", () => {
    fs.writeFileSync(hookFile, "original hook content", "utf-8");
    writeHookFileWithConflict(hookFile, "overwrite");
    expect(fs.readFileSync(hookFile, "utf-8")).toContain("ARIVE pre-commit");
    expect(fs.readFileSync(hookFile, "utf-8")).not.toContain("original hook content");
  });

  test("appends hook when file exists and action is append", () => {
    fs.writeFileSync(hookFile, "original hook content", "utf-8");
    writeHookFileWithConflict(hookFile, "append");
    const content = fs.readFileSync(hookFile, "utf-8");
    expect(content).toContain("original hook content");
    expect(content).toContain("ARIVE pre-commit");
  });

  test("skips append if hook already contains ARIVE checks", () => {
    const doubleContent = "original hook content\n# Added by ARIVE\n# ARIVE pre-commit";
    fs.writeFileSync(hookFile, doubleContent, "utf-8");
    writeHookFileWithConflict(hookFile, "append");
    expect(fs.readFileSync(hookFile, "utf-8")).toBe(doubleContent);
  });

  test("skips hook modification when action is skip", () => {
    fs.writeFileSync(hookFile, "original hook content", "utf-8");
    writeHookFileWithConflict(hookFile, "skip");
    expect(fs.readFileSync(hookFile, "utf-8")).toBe("original hook content");
  });
});
