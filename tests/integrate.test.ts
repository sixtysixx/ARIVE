import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { WorkspaceManager } from "../src/integrate/workspace.js";
import { SubagentRunner } from "../src/integrate/subagent_runner.js";
import * as fs from "fs";
import { execFileSync } from "child_process";

describe("Workspace & Subagent Integration Tests", () => {
  const taskId = "test_workspace_runner";
  const worktreePath = `.arive-worktrees/${taskId}`;

  beforeAll(() => {
    // Ensure standard Git commit exists so worktree works
    try {
      execFileSync("git", ["rev-parse", "HEAD"], { stdio: "ignore" });
    } catch (e) {
      execFileSync("git", ["init"]);
      execFileSync("git", ["config", "user.name", "Test"]);
      execFileSync("git", ["config", "user.email", "test@test.com"]);
      execFileSync("git", ["commit", "-m", "Initial", "--allow-empty"]);
    }
  });

  afterAll(() => {
    try {
      WorkspaceManager.cleanup(taskId);
    } catch (e) {}
  });

  test("Create worktree workspace", () => {
    const pathResult = WorkspaceManager.create(taskId, "arive-test-branch");
    const normalizedResult = pathResult.replace(/\\/g, "/");
    const normalizedExpected = worktreePath.replace(/\\/g, "/");
    expect(normalizedResult).toContain(normalizedExpected);
    expect(fs.existsSync(worktreePath)).toBe(true);
  });

  test("Workspace creation handles existing worktree path by cleaning it up first", () => {
    // Calling it again should clean up and recreate successfully
    const pathResult = WorkspaceManager.create(taskId, "arive-test-branch");
    const normalizedResult = pathResult.replace(/\\/g, "/");
    const normalizedExpected = worktreePath.replace(/\\/g, "/");
    expect(normalizedResult).toContain(normalizedExpected);
    expect(fs.existsSync(worktreePath)).toBe(true);
  });

  test("Run custom command via subagent runner inside worktree", () => {
    const runRes = SubagentRunner.execute(worktreePath, "git status");
    expect(runRes.exitCode).toBe(0);
    expect(runRes.stdout).toContain("On branch");
  });

  test("Subagent runner returns non-zero exit code on failing command", () => {
    const runRes = SubagentRunner.execute(worktreePath, "non_existent_command_12345");
    expect(runRes.exitCode).not.toBe(0);
  });

  test("Cleanup removes the workspace directory and branch", () => {
    WorkspaceManager.cleanup(taskId);
    expect(fs.existsSync(worktreePath)).toBe(false);
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

