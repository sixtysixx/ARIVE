import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function sleepSync(ms: number): void {
  try {
    const sharedBuffer = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sharedBuffer, 0, 0, ms);
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {}
  }
}

function rmSyncWithRetry(targetPath: string, retries = 5, delayMs = 150): void {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      return;
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw err;
      }
      sleepSync(delayMs * attempt);
    }
  }
}

function execGitWithRetry(args: string[], retries = 3, delayMs = 150): void {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      execFileSync("git", args, { stdio: "ignore" });
      return;
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw lastError;
      }
      sleepSync(delayMs * attempt);
    }
  }
}

export class WorkspaceManager {
  public static validateTaskId(taskId: string): void {
    const taskIdRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!taskIdRegex.test(taskId)) {
      throw new Error(`Invalid taskId: "${taskId}". Task ID must only contain alphanumeric characters, underscores, or hyphens.`);
    }
  }

  private static validateBranchName(branchName: string): void {
    const branchNameRegex = /^[a-zA-Z0-9_\-\.\/]+$/;
    if (!branchNameRegex.test(branchName) || branchName.includes("..") || branchName.endsWith("/")) {
      throw new Error(`Invalid branchName: "${branchName}". Branch name contains illegal characters.`);
    }
  }

  public static create(taskId: string, branchName?: string): string {
    this.validateTaskId(taskId);
    if (branchName) {
      this.validateBranchName(branchName);
    }

    const targetBranch = branchName || `arive-task-${taskId}`;
    const targetPath = path.join(".arive-worktrees", taskId);

    // Ensure we are inside a Git repo
    try {
      execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
    } catch (e) {
      execFileSync("git", ["init"]);
      execFileSync("git", ["config", "user.name", "ARIVE Server"]);
      execFileSync("git", ["config", "user.email", "arive@mcp.local"]);
      fs.writeFileSync(".gitignore", ".arive-worktrees/\n.arive/\nnode_modules/\ndist/\n", "utf-8");
      execFileSync("git", ["add", ".gitignore"]);
      execFileSync("git", ["commit", "-m", "chore: initialize Git and gitignore"]);
    }

    // Check if target directory already exists
    if (fs.existsSync(targetPath)) {
      this.cleanup(taskId);
    }

    // Clean worktree registry if needed
    try {
      execFileSync("git", ["worktree", "prune"], { stdio: "ignore" });
    } catch (e) {}

    // If the branch already exists, delete it first to ensure a fresh one
    try {
      execFileSync("git", ["branch", "-D", targetBranch], { stdio: "ignore" });
    } catch (e) {}

    // Add the worktree
    execFileSync("git", ["worktree", "add", "-b", targetBranch, targetPath], { stdio: "ignore" });

    return path.resolve(targetPath);
  }

  public static cleanup(taskId: string): void {
    this.validateTaskId(taskId);
    const targetPath = path.join(".arive-worktrees", taskId);
    const branchName = `arive-task-${taskId}`;

    if (fs.existsSync(targetPath)) {
      try {
        execGitWithRetry(["worktree", "remove", "--force", targetPath], 3, 150);
      } catch (e) {
        // Attempt file cleanup even if worktree remove fails
      }

      try {
        rmSyncWithRetry(targetPath, 5, 150);
      } catch (e) {
        console.warn(`[WorkspaceManager] Failed to clean up directory: ${targetPath} - ${e}`);
      }
    }

    try {
      execFileSync("git", ["branch", "-D", branchName], { stdio: "ignore" });
    } catch (e) {}

    try {
      execFileSync("git", ["branch", "-D", "arive-test-branch"], { stdio: "ignore" });
    } catch (e) {}

    try {
      execFileSync("git", ["worktree", "prune"], { stdio: "ignore" });
    } catch (e) {}
  }
}

