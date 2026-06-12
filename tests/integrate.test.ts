import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { WorkspaceManager } from "../src/integrate/workspace.js";
import { SubagentRunner } from "../src/integrate/subagent_runner.js";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import * as os from "os";

describe("Workspace & Subagent Integration Tests", () => {
  const taskId = "test_workspace_runner";
  let tempDir: string;
  let originalCwd: string;
  let worktreePath: string;

  beforeAll(() => {
    // Clear git environment variables that might be set during hooks
    // to ensure tests run in a truly independent environment.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GIT_") && key !== "GIT_CONFIG_NOSYSTEM") {
        delete process.env[key];
      }
    }

    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-test-"));
    process.chdir(tempDir);

    // Initialize a fresh git repo in the temp dir
    execFileSync("git", ["init"]);
    execFileSync("git", ["config", "user.name", "Test"]);
    execFileSync("git", ["config", "user.email", "test@test.com"]);
    execFileSync("git", ["commit", "-m", "Initial", "--allow-empty"]);
    
    worktreePath = path.join(tempDir, ".arive-worktrees", taskId);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    try {
      // Clean up temp dir
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test("Create worktree workspace", () => {
    const pathResult = WorkspaceManager.create(taskId, "arive-test-branch");
    expect(fs.existsSync(pathResult)).toBe(true);
    expect(pathResult).toContain(taskId);
  });

  test("Workspace creation handles existing worktree path by cleaning it up first", () => {
    // Calling it again should clean up and recreate successfully
    const pathResult = WorkspaceManager.create(taskId, "arive-test-branch");
    expect(fs.existsSync(pathResult)).toBe(true);
  });

  test("Run custom command via subagent runner inside worktree", () => {
    const absWorktreePath = path.resolve(".arive-worktrees", taskId);
    const runRes = SubagentRunner.execute(absWorktreePath, "git status");
    expect(runRes.exitCode).toBe(0);
    expect(runRes.stdout).toContain("On branch");
  });

  test("Subagent runner returns non-zero exit code on failing command", () => {
    const absWorktreePath = path.resolve(".arive-worktrees", taskId);
    const runRes = SubagentRunner.execute(absWorktreePath, "non_existent_command_12345");
    expect(runRes.exitCode).not.toBe(0);
  });

  test("Cleanup removes the workspace directory and branch", () => {
    WorkspaceManager.cleanup(taskId, "arive-test-branch");
    const absWorktreePath = path.resolve(".arive-worktrees", taskId);
    expect(fs.existsSync(absWorktreePath)).toBe(false);
  });

  test("should list active worktrees", () => {
    const listTaskId = "test-list-task";
    WorkspaceManager.create(listTaskId, "test-list-branch");
    // @ts-ignore
    const list = WorkspaceManager.list();
    const item = list.find((w: any) => w.taskId === listTaskId);
    expect(item).toBeDefined();
    expect(item?.branch).toBe("test-list-branch");
    WorkspaceManager.cleanup(listTaskId);
  });


  test("WorkspaceManager rejects invalid taskId patterns to prevent command/path injection", () => {
    expect(() => {
      WorkspaceManager.create("invalid-task; rm -rf");
    }).toThrow();

    expect(() => {
      WorkspaceManager.create("../escaped-path");
    }).toThrow();
  });

  test("WorkspaceManager rejects invalid branchName patterns to prevent command injection", () => {
    expect(() => {
      WorkspaceManager.create(taskId, "test-branch; echo injected");
    }).toThrow();
  });

  test("SubagentRunner restricts command execution to allowed workspace boundary", () => {
    expect(() => {
      SubagentRunner.execute("C:/Windows/System32", "dir");
    }).toThrow(/Security Exception/);
  });
});

