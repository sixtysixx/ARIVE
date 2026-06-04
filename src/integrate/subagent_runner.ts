import { spawnSync } from "child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class SubagentRunner {
  public static execute(cwd: string, command: string): ExecResult {
    // Runs standard commands in shell relative to workspace cwd
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "powershell.exe" : "sh";
    const arg = isWindows ? "-Command" : "-c";

    const proc = spawnSync(shell, [arg, command], {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        PAGER: "cat",
        FORCE_COLOR: "0" // Keep output logs color-free for parsing
      }
    });

    return {
      exitCode: proc.status ?? (proc.error ? 1 : 0),
      stdout: proc.stdout || "",
      stderr: proc.stderr || (proc.error ? proc.error.message : "")
    };
  }
}
