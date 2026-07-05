import * as fs from "fs";
import * as path from "path";

export interface WorkspaceInfo {
  taskId: string;
  path: string;
  createdAt?: string;
}

export class WorkspaceManager {
  public static validateTaskId(taskId: string): void {
    if (!taskId || typeof taskId !== "string") {
      throw new Error("Invalid taskId");
    }

    const rootDir = path.resolve(process.cwd());
    const taskBaseDir = path.join(rootDir, ".arive-tasks");
    const absoluteTargetPath = path.resolve(taskBaseDir, taskId);

    // Strictly enforce that the target path is within taskBaseDir.
    // If we want to allow going exactly ONE level above, it's NOT secure because they could overwrite `src`.
    // Wait, the review says: "Update validateTaskId() in workspace.ts to resolve and validate absoluteTargetPath strictly within taskBaseDir, rejecting anything outside that directory before cleanup() can use it. Use the existing symbols validateTaskId, taskBaseDir, and absoluteTargetPath to keep the fix localized and ensure only .arive-tasks subpaths are accepted."
    if (!absoluteTargetPath.startsWith(taskBaseDir + path.sep) && absoluteTargetPath !== taskBaseDir) {
      throw new Error("Security Exception: Path traversal detected outside of .arive-tasks");
    }
  }

  public static getTaskPath(taskId: string): string {
    this.validateTaskId(taskId);
    return path.resolve(process.cwd(), ".arive-tasks", taskId);
  }

  public static create(
    taskId: string,
    options?: { ignore?: Iterable<string> },
  ): string {
    this.validateTaskId(taskId);
    const absoluteTargetPath = this.getTaskPath(taskId);

    // Clean up if exists
    this.cleanup(taskId);

    // Create the directory
    fs.mkdirSync(absoluteTargetPath, { recursive: true });

    // Copy project files (excluding .git, node_modules, .arive-tasks, .arive-worktrees, .arive, bun.lock by default)
    const sourceDir = path.resolve(process.cwd());
    const ignored = new Set([
      ".git",
      "node_modules",
      ".arive-tasks",
      ".arive-worktrees",
      ".arive",
      "bun.lock",
      ...(options?.ignore ?? []),
    ]);

    // Read all entries and copy individually to avoid self-copy issues
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) {
        continue;
      }
      const src = path.join(sourceDir, entry.name);
      const dest = path.join(absoluteTargetPath, entry.name);
      try {
        fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[WorkspaceManager] Failed to copy ${entry.name}: ${message}`);
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
    const absoluteTargetPath = this.getTaskPath(taskId);

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
