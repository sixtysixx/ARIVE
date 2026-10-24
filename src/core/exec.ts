import { spawn } from "child_process";

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Maximum bytes captured per stream before truncation. */
  maxBytes?: number;
  stdin?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/**
 * Runs a command without a shell, capturing stdout/stderr with a byte cap.
 * Never throws for a non-zero exit; callers inspect `code`.
 */
export function runCommand(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 1_000_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}), FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= maxBytes) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > maxBytes) {
        truncated = true;
        return next.slice(0, maxBytes);
      }
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, "utf8");
    } else {
      child.stdin?.end();
    }

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, truncated });
    };

    child.on("error", (error) => {
      stderr += `spawn error: ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
