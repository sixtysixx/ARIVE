import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

export class HookManager {
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

    // Find if a hook file matching hookName exists
    const entries = fs.readdirSync(hooksDir);
    const hookFile = entries.find((entry) => {
      const ext = path.extname(entry);
      const base = path.basename(entry, ext);
      return base === hookName && !entry.endsWith(".sample");
    });

    if (!hookFile) {
      return { success: true };
    }

    const absoluteHookPath = path.resolve(hooksDir, hookFile);

    // Make sure it is a file
    if (!fs.statSync(absoluteHookPath).isFile()) {
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
      const proc = spawnSync(command, args, {
        encoding: "utf-8",
        env,
        timeout: 10_000,
        shell: ext !== ".js" && ext !== ".ts" && ext !== ".ps1",
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
