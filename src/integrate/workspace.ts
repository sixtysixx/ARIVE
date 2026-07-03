import * as fs from "fs";
import * as path from "path";

export interface WorkspaceInfo {
  taskId: string;
  path: string;
  createdAt?: string;
}

export class WorkspaceManager {
  public static validateTaskId(taskId: string): void {
    if (
      !taskId ||
      typeof taskId !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(taskId)
    ) {
      throw new Error(
        "Invalid taskId: must be alphanumeric, underscores, or dashes only",
      );
    }
  }

  public static create(taskId: string): string {
    this.validateTaskId(taskId);
    const targetPath = path.join(".arive-tasks", taskId);
    const absoluteTargetPath = path.resolve(targetPath);

    // Clean up if exists
    this.cleanup(taskId);

    // Create the directory
    fs.mkdirSync(absoluteTargetPath, { recursive: true });

    // Copy project files (excluding .git, node_modules, .arive-tasks, .arive, bun.lock)
    const sourceDir = path.resolve(process.cwd());
    const excludeList: Record<string, boolean> = {
      ".git": true,
      node_modules: true,
      ".arive-tasks": true,
      ".arive-worktrees": true,
      ".arive": true,
      "bun.lock": true,
    };

    const entries = fs.readdirSync(sourceDir);
    for (const entry of entries) {
      if (excludeList[entry]) {
        continue;
      }
      const srcPath = path.join(sourceDir, entry);
      const destPath = path.join(absoluteTargetPath, entry);
      try {
        fs.cpSync(srcPath, destPath, { recursive: true, verbatimSymlinks: true });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WorkspaceManager] Failed to copy ${srcPath}: ${message}`,
        );
      }
    }

    // Symlink node_modules
    const sourceModules = path.join(sourceDir, "node_modules");
    const targetModules = path.join(absoluteTargetPath, "node_modules");
    if (fs.existsSync(sourceModules)) {
      try {
        const type = process.platform === "win32" ? "junction" : "dir";
        fs.symlinkSync(sourceModules, targetModules, type);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WorkspaceManager] Failed to symlink node_modules: ${message}`,
        );
      }
    }

    return absoluteTargetPath;
  }

  public static list(): WorkspaceInfo[] {
    const taskBaseDir = path.resolve(".arive-tasks");
    if (!fs.existsSync(taskBaseDir)) {
      return [];
    }

    const entries = fs.readdirSync(taskBaseDir, { withFileTypes: true });
    const workspaces: WorkspaceInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const taskId = entry.name;
        const targetPath = path.join(taskBaseDir, taskId);
        try {
          const stat = fs.statSync(targetPath);
          workspaces.push({
            taskId,
            path: targetPath,
            createdAt: stat.birthtime.toISOString(),
          });
        } catch {
          // Ignore stats errors
        }
      }
    }

    return workspaces;
  }

  public static cleanup(taskId: string): void {
    this.validateTaskId(taskId);
    const targetPath = path.join(".arive-tasks", taskId);
    const absoluteTargetPath = path.resolve(targetPath);

    if (fs.existsSync(absoluteTargetPath)) {
      // Retry delete to avoid file locking on Windows
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.rmSync(absoluteTargetPath, { recursive: true, force: true });
          break;
        } catch (err: unknown) {
          if (attempt === 5) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `[WorkspaceManager] Failed to clean up directory after 5 attempts: ${absoluteTargetPath} - ${message}`,
            );
          }
          // Sleep sync
          const start = Date.now();
          while (Date.now() - start < 150) {}
        }
      }
    }
  }
}
