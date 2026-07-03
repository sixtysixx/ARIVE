import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

export class HookManager {
  private static hookCache = new Map<
    string,
    { command: string; args: string[]; mtime: number; path: string } | null
  >();

  public static runHook(
    hookName: string,
    phase: string,
    context: unknown,
    result?: unknown,
  ): { success: boolean; error?: string } {
    const hooksDir = path.resolve(".arive", "hooks");
    if (!fs.existsSync(hooksDir)) {
      return { success: true };
    }

    // Resolve hook file (cached)
    let cached = HookManager.hookCache.get(hookName);
    const hooksDirExists = fs.existsSync(hooksDir);
    let hookFile: string | undefined;

    if (cached) {
      // Validate cache: file exists and mtime unchanged
      try {
        const stat = fs.statSync(cached.path);
        if (stat.isFile() && stat.mtimeMs === cached.mtime) {
          hookFile = path.basename(cached.path);
        } else {
          HookManager.hookCache.delete(hookName);
          cached = null;
        }
      } catch {
        HookManager.hookCache.delete(hookName);
        cached = null;
      }
    }

    if (!cached) {
      if (!hooksDirExists) {
        return { success: true };
      }
      const entries = fs.readdirSync(hooksDir);
      hookFile = entries.find((entry) => {
        const ext = path.extname(entry);
        const base = path.basename(entry, ext);
        return base === hookName && !entry.endsWith(".sample");
      });

      if (!hookFile) {
        HookManager.hookCache.set(hookName, null);
        return { success: true };
      }

      const absoluteHookPath = path.resolve(hooksDir, hookFile);
      const stat = fs.statSync(absoluteHookPath);
      if (!stat.isFile()) {
        HookManager.hookCache.set(hookName, null);
        return { success: true };
      }

      const ext = path.extname(hookFile).toLowerCase();
      let command = "";
      let args: string[] = [];

      const isWindows = process.platform === "win32";

      if (ext === ".js" || ext === ".ts") {
        command = "bun";
        args = ["run", absoluteHookPath];
      } else if (ext === ".sh") {
        if (isWindows) {
          command = "sh";
          args = [absoluteHookPath];
        } else {
          command = absoluteHookPath;
        }
      } else if (ext === ".ps1") {
        command = "powershell.exe";
        args = [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          absoluteHookPath,
        ];
      } else if (ext === ".bat" || ext === ".cmd") {
        if (isWindows) {
          command = absoluteHookPath;
        } else {
          HookManager.hookCache.set(hookName, null);
          return {
            success: false,
            error: `Cannot execute Windows batch file ${hookFile} on non-Windows platform.`,
          };
        }
      } else {
        if (isWindows) {
          command = "cmd.exe";
          args = ["/c", absoluteHookPath];
        } else {
          command = absoluteHookPath;
        }
      }

      cached = { command, args, mtime: stat.mtimeMs, path: absoluteHookPath };
      HookManager.hookCache.set(hookName, cached);
    }

    // Run the process
    const env = {
      ...process.env,
      ARIVE_HOOK_NAME: hookName,
      ARIVE_HOOK_PHASE: phase,
      ARIVE_HOOK_CONTEXT: JSON.stringify(context || {}),
      ARIVE_HOOK_RESULT: JSON.stringify(result || {}),
      FORCE_COLOR: "0",
    };

    try {
      const proc = spawnSync(cached.command, cached.args, {
        encoding: "utf-8",
        env,
        timeout: 10_000,
        shell:
          path.extname(cached.path).toLowerCase() !== ".js" &&
          path.extname(cached.path).toLowerCase() !== ".ts" &&
          path.extname(cached.path).toLowerCase() !== ".ps1",
      });

      if (proc.error) {
        return {
          success: false,
          error: `Hook execution failed: ${proc.error.message}`,
        };
      }

      if (proc.status !== 0) {
        const stderr = proc.stderr?.trim() || "";
        const stdout = proc.stdout?.trim() || "";
        const output = [stdout, stderr].filter(Boolean).join("\n");
        return {
          success: false,
          error: `Hook exited with code ${proc.status || -1}. Output:\n${output}`,
        };
      }

      return { success: true };
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        error: `Hook execution threw an error: ${errorMsg}`,
      };
    }
  }
}
