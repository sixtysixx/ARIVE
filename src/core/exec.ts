import { spawn } from "child_process";

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Maximum bytes captured per stream before truncation. */
  maxBytes?: number;
  stdin?: string;
  /**
   * Consumes stdout line by line as it arrives, so a caller that only needs the
   * first N records never waits for (or buffers) the whole stream. Returning
   * false kills the child and marks the result `stopped`. `stdout` stays empty
   * when this is set: the callback owns the output.
   */
  onStdoutLine?: (line: string) => boolean | void;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** The callback asked to stop, so the exit code reflects the kill. */
  stopped: boolean;
  /** Termination signal, present only when the child was killed by one. */
  signal: string | null;
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
  const onStdoutLine = options.onStdoutLine;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let stopped = false;
    let pending = "";
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

    // A child that exits before reading stdin would otherwise surface as an
    // unhandled EPIPE on the write side.
    child.stdin?.on("error", () => {});

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

    const stop = (): void => {
      stopped = true;
      pending = "";
      child.kill("SIGKILL");
    };

    /** Feeds complete lines to the callback; false means "we have enough". */
    const drain = (flush: boolean): void => {
      if (!onStdoutLine) return;
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (onStdoutLine(line) === false) {
          stop();
          return;
        }
        index = pending.indexOf("\n");
      }
      if (flush && pending !== "") {
        const tail = pending;
        pending = "";
        if (onStdoutLine(tail) === false) stopped = true;
        return;
      }
      // A single line larger than the cap would grow memory without bound.
      if (!flush && pending.length > maxBytes) {
        truncated = true;
        stop();
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!onStdoutLine) {
        stdout = append(stdout, chunk);
        return;
      }
      if (stopped) return;
      pending += chunk.toString("utf8");
      drain(false);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, "utf8");
    } else {
      child.stdin?.end();
    }

    const finish = (code: number | null, signal: string | null = null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!stopped) drain(true);
      resolve({ code, stdout, stderr, timedOut, truncated, stopped, signal });
    };

    child.on("error", (error) => {
      stderr += `spawn error: ${error.message}`;
      finish(null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
