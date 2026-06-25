import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class SubagentRunner {
  public static execute(cwd: string, command: string): ExecResult {
    const absoluteCwd = path.resolve(cwd);
    const rootDir = path.resolve(process.cwd());
    const taskBaseDir = path.join(rootDir, ".arive-tasks");

    // Restrict execution to the project root or subdirectories of the task base dir
    const isInsideRoot = absoluteCwd === rootDir;
    const isInsideTask =
      absoluteCwd.startsWith(taskBaseDir + path.sep) ||
      absoluteCwd === taskBaseDir;

    if (!isInsideRoot && !isInsideTask) {
      throw new Error(
        `Security Exception: Execution directory "${cwd}" is outside allowed workspace boundaries.`,
      );
    }

    if (
      !fs.existsSync(absoluteCwd) ||
      !fs.statSync(absoluteCwd).isDirectory()
    ) {
      throw new Error(
        `Directory Exception: Execution directory "${cwd}" does not exist or is not a directory.`,
      );
    }

    const isWindows = process.platform === "win32";
    const shell = isWindows ? "powershell.exe" : "sh";
    const args = isWindows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ]
      : ["-c", command];

    const proc = spawnSync(shell, args, {
      cwd: absoluteCwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        PAGER: "cat",
        FORCE_COLOR: "0", // Keep output logs color-free for parsing
      },
    });

    if (proc.error) {
      return {
        exitCode: proc.status ?? -1,
        stdout: proc.stdout || "",
        stderr: `Subprocess execution failed: ${proc.error.message}`,
      };
    }

    if (proc.signal) {
      return {
        exitCode: -1,
        stdout: proc.stdout || "",
        stderr: `Subprocess terminated by signal: ${proc.signal}`,
      };
    }

    return {
      exitCode: proc.status ?? 0,
      stdout: proc.stdout || "",
      stderr: proc.stderr || "",
    };
  }
}
