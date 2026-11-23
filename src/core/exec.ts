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
   * false kills the child and sets `outcome` to `stopped`. `stdout` stays empty
   * when this is set: the callback owns the output.
   */
  onStdoutLine?: (line: string) => boolean | void;
}

/** Why the process ended. Exactly one applies, so the cases cannot drift apart. */
export type ExecOutcome =
  | "exited"
  | "timeout"
  | "stopped"
  | "capExceeded"
  | "spawnError";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The byte cap discarded output; orthogonal to `outcome`. */
  truncated: boolean;
  /** Termination signal, present only when the child was killed by one. */
  signal: string | null;
  outcome: ExecOutcome;
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
    let killedBy: "callback" | "cap" | "timeout" | undefined;
    let spawnFailed = false;
    let pending = "";
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}), FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      // The child can exit on the same tick the deadline fires; killing it
      // then would turn a clean exit into a reported timeout.
      if (settled) return;
      killedBy = "timeout";
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

    const stop = (reason: "callback" | "cap"): void => {
      if (!killedBy) killedBy = reason;
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
          stop("callback");
          return;
        }
        index = pending.indexOf("\n");
      }
      if (flush && pending !== "") {
        const tail = pending;
        pending = "";
        if (onStdoutLine(tail) === false && !killedBy) killedBy = "callback";
        return;
      }
      // A single line larger than the cap would grow memory without bound.
      if (!flush && pending.length > maxBytes) {
        truncated = true;
        stop("cap");
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!onStdoutLine) {
        stdout = append(stdout, chunk);
        return;
      }
      if (killedBy) return;
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
      if (killedBy !== "callback" && killedBy !== "cap") drain(true);
      // A child that exited 0 in the same tick the deadline fired answered in
      // time; the flag alone cannot tell those apart.
      const timedOut = killedBy === "timeout" && !(code === 0 && signal === null);
      const outcome: ExecOutcome = spawnFailed
        ? "spawnError"
        : timedOut
          ? "timeout"
          : killedBy === "cap"
            ? "capExceeded"
            : killedBy === "callback"
              ? "stopped"
              : "exited";
      resolve({
        code,
        stdout,
        stderr,
        truncated,
        signal,
        outcome,
      });
    };

    child.on("error", (error) => {
      spawnFailed = true;
      stderr += `spawn error: ${error.message}`;
      finish(null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
