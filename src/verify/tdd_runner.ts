import { spawnSync } from "child_process";
import * as fs from "fs";

export class TDDRunner {
  public static run(cwd: string, testCommand: string): {
    success: boolean;
    failures: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  } {
    const parts = testCommand.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    let stdoutAccum = "";
    let stderrAccum = "";
    const failures: string[] = [];
    let success = true;
    let exitCode = 0;

    const failRegex = /(FAIL|failing|Error:|Exception|failed)/i;

    try {
      const child = spawnSync(cmd, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: true,
        timeout: 10000,
        encoding: "utf-8"
      });

      stdoutAccum = child.stdout || "";
      stderrAccum = child.stderr || "";
      exitCode = child.status !== null ? child.status : 1;

      const lines = (stdoutAccum + "\n" + stderrAccum).split("\n");
      lines.forEach(line => {
        if (failRegex.test(line)) {
          success = false;
          failures.push(line.trim());
        }
      });

      if (exitCode !== 0) {
        success = false;
      }

    } catch (e: any) {
      success = false;
      failures.push(e.message || "Failed to execute test command execution");
    }

    return {
      success,
      failures: failures.slice(0, 10),
      exitCode,
      stdout: stdoutAccum,
      stderr: stderrAccum
    };
  }
}
