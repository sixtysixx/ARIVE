import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

interface HookCacheEntry {
  present: boolean;
  dirsSignature: string;
  command: string;
  args: string[];
  mtime: number;
  path: string;
}

export class HookManager {
  private static hookCache = new Map<string, HookCacheEntry>();

  /**
   * Hook directories, in priority order. The first directory containing a
   * matching `<hookName>.<ext>` file wins; later directories are ignored for
   * that hook.
   *
   *   1. $ARIVE_HOOKS_DIR    — explicit override
   *   2. <cwd>/.arive/hooks  — project-local
   *   3. ~/.arive/hooks      — user-global
   */
  public static resolveHookDirs(): string[] {
    const dirs: string[] = [];

    const override = process.env.ARIVE_HOOKS_DIR?.trim();
    if (override) {
      dirs.push(path.resolve(override));
    }

    dirs.push(path.resolve(".arive", "hooks"));

    const home = os.homedir();
    if (home) {
      dirs.push(path.join(home, ".arive", "hooks"));
    }

    return [...new Set(dirs)];
  }

  public static runHook(
    hookName: string,
    phase: string,
    context: unknown,
    result?: unknown,
  ): { success: boolean; error?: string } {
    const hooksDirs = HookManager.resolveHookDirs().filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
    if (hooksDirs.length === 0) {
      return { success: true };
    }

    const dirsSignature = hooksDirs.join(path.delimiter);
    let cached = HookManager.hookCache.get(hookName);
    let hookFile: string | undefined;

    if (cached) {
      if (cached.dirsSignature !== dirsSignature) {
        // Hook directories appeared or vanished since this entry was cached.
        HookManager.hookCache.delete(hookName);
        cached = undefined;
      } else if (!cached.present) {
        return { success: true };
      } else {
        // Validate cache: file exists and mtime unchanged
        try {
          const stat = fs.statSync(cached.path);
          if (stat.isFile() && stat.mtimeMs === cached.mtime) {
            hookFile = path.basename(cached.path);
          } else {
            HookManager.hookCache.delete(hookName);
            cached = undefined;
          }
        } catch {
          HookManager.hookCache.delete(hookName);
          cached = undefined;
        }
      }
    }

    if (!cached) {
      let absoluteHookPath: string | undefined;

      for (const hooksDir of hooksDirs) {
        let entries: string[];
        try {
          entries = fs.readdirSync(hooksDir);
        } catch {
          continue;
        }

        const found = entries.find((entry) => {
          const ext = path.extname(entry);
          return path.basename(entry, ext) === hookName && !entry.endsWith(".sample");
        });
        if (!found) {
          continue;
        }

        const candidate = path.resolve(hooksDir, found);
        try {
          if (fs.statSync(candidate).isFile()) {
            absoluteHookPath = candidate;
            break;
          }
        } catch {
          // Unreadable candidate; fall through to the next hooks directory.
        }
      }

      if (!absoluteHookPath) {
        HookManager.hookCache.set(hookName, {
          present: false,
          dirsSignature,
          command: "",
          args: [],
          mtime: 0,
          path: "",
        });
        return { success: true };
      }

      const stat = fs.statSync(absoluteHookPath);
      hookFile = path.basename(absoluteHookPath);

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

      cached = {
        present: true,
        dirsSignature,
        command,
        args,
        mtime: stat.mtimeMs,
        path: absoluteHookPath,
      };
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
