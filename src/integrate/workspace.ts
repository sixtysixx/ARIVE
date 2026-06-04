import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export class WorkspaceManager {
  public static create(taskId: string, branchName?: string): string {
    const targetBranch = branchName || `arive-task-${taskId}`;
    const targetPath = path.join(".arive-worktrees", taskId);

    // Ensure we are inside a Git repo
    try {
      execSync("git rev-parse --git-dir", { stdio: "ignore" });
    } catch (e) {
      execSync("git init");
      execSync("git config user.name 'ARIVE Server'");
      execSync("git config user.email 'arive@mcp.local'");
      fs.writeFileSync(".gitignore", ".arive-worktrees/\n.arive/\nnode_modules/\ndist/\n", "utf-8");
      execSync("git add .gitignore && git commit -m 'chore: initialize Git and gitignore'");
    }

    // Check if target directory already exists
    if (fs.existsSync(targetPath)) {
      this.cleanup(taskId);
    }

    // Clean worktree registry if needed
    try {
      execSync(`git worktree prune`, { stdio: "ignore" });
    } catch (e) {}

    // If the branch already exists, delete it first to ensure a fresh one
    try {
      execSync(`git branch -D ${targetBranch}`, { stdio: "ignore" });
    } catch (e) {}

    // Add the worktree
    execSync(`git worktree add -b ${targetBranch} ${targetPath}`, { stdio: "ignore" });

    return path.resolve(targetPath);
  }

  public static cleanup(taskId: string): void {
    const targetPath = path.join(".arive-worktrees", taskId);
    const branchName = `arive-task-${taskId}`;

    if (fs.existsSync(targetPath)) {
      try {
        execSync(`git worktree remove --force ${targetPath}`, { stdio: "ignore" });
      } catch (e) {}

      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch (e) {}
    }

    try {
      execSync(`git branch -D ${branchName}`, { stdio: "ignore" });
    } catch (e) {}

    try {
      execSync(`git branch -D arive-test-branch`, { stdio: "ignore" });
    } catch (e) {}

    try {
      execSync("git worktree prune", { stdio: "ignore" });
    } catch (e) {}
  }
}
