import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { WorkspaceManager } from "../src/integrate/workspace.js";
import { SubagentRunner } from "../src/integrate/subagent_runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Workspace & Subagent Integration Tests", () => {
  const taskId = "test_workspace_runner";
  let tempDir: string;
  let originalCwd: string;
  let taskPath: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-test-"));
    process.chdir(tempDir);

    // Create a dummy file in root to verify it gets copied
    fs.writeFileSync("dummy.txt", "hello", "utf-8");
    // Create a dummy node_modules to verify it gets symlinked
    fs.mkdirSync("node_modules");
    fs.writeFileSync("node_modules/test-dep.txt", "dependency", "utf-8");

    taskPath = path.join(tempDir, ".arive-tasks", taskId);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error of temp dir
    }
  });

  test("Create directory workspace", () => {
    const createdPath = WorkspaceManager.create(taskId);
    expect(createdPath).toBe(path.resolve(taskPath));
    expect(fs.existsSync(createdPath)).toBe(true);
    expect(fs.existsSync(path.join(createdPath, "dummy.txt"))).toBe(true);
    expect(fs.existsSync(path.join(createdPath, "node_modules"))).toBe(true);
  });

  test("Workspace creation handles existing path by cleaning it up first", () => {
    // Add a file in the workspace
    fs.writeFileSync(
      path.join(taskPath, "should_be_deleted.txt"),
      "delete me",
      "utf-8",
    );

    // Recreate
    WorkspaceManager.create(taskId);
    expect(fs.existsSync(path.join(taskPath, "should_be_deleted.txt"))).toBe(
      false,
    );
  });

  test("Run custom command via subagent runner inside workspace", () => {
    const result = SubagentRunner.execute(taskPath, "echo hello-world");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
  });

  test("Subagent runner returns non-zero exit code on failing command", () => {
    const result = SubagentRunner.execute(taskPath, "exit 123");
    expect(result.exitCode).toBe(123);
  });

  test("Subagent runner handles subprocess run errors", () => {
    // Use an invalid command name to trigger spawnSync error
    const result = SubagentRunner.execute(
      taskPath,
      "thiscommanddoesnotexist_abc123",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("Cleanup removes the workspace directory", () => {
    WorkspaceManager.cleanup(taskId);
    expect(fs.existsSync(taskPath)).toBe(false);
  });

  test("should list active task directories", () => {
    const listTaskId = "list_test_task";
    WorkspaceManager.create(listTaskId);

    const list = WorkspaceManager.list();
    const item = list.find((w) => w.taskId === listTaskId);
    expect(item).toBeDefined();
    expect(item?.path).toContain(listTaskId);
    WorkspaceManager.cleanup(listTaskId);
  });

  test("WorkspaceManager rejects invalid taskId patterns to prevent command/path injection", () => {
    expect(() => WorkspaceManager.create("../escaped")).toThrow();
    expect(() => WorkspaceManager.create("invalid taskId; rm -rf /")).toThrow();
  });

  test("SubagentRunner restricts command execution to allowed workspace boundary", () => {
    expect(() => SubagentRunner.execute("/some/other/path", "echo")).toThrow();
  });
});
