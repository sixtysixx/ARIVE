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

export interface WorkspaceInfo {
  taskId: string;
  path: string;
  branch: string;
  createdAt?: string;
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

    // Comprehensive cleanup before creation
    this.cleanup(taskId, targetBranch);

    // Ensure the parent directory exists before git worktree add
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Add the worktree with retry logic for Windows lock issues
    let lastError: Error | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        // Use -B to create or reset the branch, which is more robust than manual deletion
        execFileSync("git", ["worktree", "add", "-B", targetBranch, targetPath], { 
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
        });
        lastError = null;
        break;
      } catch (e: any) {
        const stderr = e.stderr?.toString() || "";
        lastError = new Error(`Failed to add git worktree: ${stderr || e.message}`);
        // Wait briefly before retry
        const delay = (i + 1) * 200;
        const start = Date.now();
        while (Date.now() - start < delay) { /* sync sleep */ }
      }
    }

    if (lastError) {
      throw lastError;
    }

    // Dependency Isolation: Symlink node_modules
    const sourceModules = path.resolve("node_modules");
    const targetModules = path.join(path.resolve(targetPath), "node_modules");
    if (fs.existsSync(sourceModules)) {
      try {
        // On Windows, symlink requires elevation or Developer Mode, but junction works for directories
        fs.symlinkSync(sourceModules, targetModules, "junction");
      } catch (e) {
        console.warn(`[WorkspaceManager] Failed to symlink node_modules: ${e}`);
      }
    }

    return path.resolve(targetPath);
  }

  public static list(): WorkspaceInfo[] {
    try {
      const output = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf-8" });
      const worktrees: WorkspaceInfo[] = [];
      const blocks = output.split("\n\n");

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        const info: any = {};
        for (const line of lines) {
          const [key, ...valueParts] = line.split(" ");
          const value = valueParts.join(" ");
          if (key === "worktree") info.path = value;
          if (key === "branch") info.branch = value.replace("refs/heads/", "");
        }

        if (info.path && info.path.includes(".arive-worktrees")) {
          const taskId = path.basename(info.path);
          worktrees.push({
            taskId,
            path: info.path,
            branch: info.branch || "detached",
            createdAt: fs.statSync(info.path).birthtime.toISOString()
          });
        }
      }
      return worktrees;
    } catch (e) {
      return [];
    }
  }

  public static cleanup(taskId: string, branchName?: string): void {
    this.validateTaskId(taskId);
    const targetPath = path.join(".arive-worktrees", taskId);
    const defaultBranch = `arive-task-${taskId}`;
    const targetBranch = branchName || defaultBranch;

    // Always try to prune first to clean up any "ghost" worktrees in git's internal state
    try {
      execFileSync("git", ["worktree", "prune"], { stdio: "ignore" });
    } catch (e) {}

    // Try to remove the worktree by path if git knows about it
    try {
      execGitWithRetry(["worktree", "remove", "--force", targetPath], 3, 150);
    } catch (e) {
      // It might not be a registered worktree, which is fine
    }

    // Ensure directory is gone from disk
    if (fs.existsSync(targetPath)) {
      try {
        rmSyncWithRetry(targetPath, 5, 150);
      } catch (e) {
        console.warn(`[WorkspaceManager] Failed to clean up directory: ${targetPath} - ${e}`);
      }
    }

    // Clean up the target branch if it's not the current one
    try {
      execFileSync("git", ["branch", "-D", targetBranch], { stdio: "ignore" });
    } catch (e) {}

    // Also clean up the default branch if it's different
    if (targetBranch !== defaultBranch) {
      try {
        execFileSync("git", ["branch", "-D", defaultBranch], { stdio: "ignore" });
      } catch (e) {}
    }

    // Final prune
    try {
      execFileSync("git", ["worktree", "prune"], { stdio: "ignore" });
    } catch (e) {}
  }
}
