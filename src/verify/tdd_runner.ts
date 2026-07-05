import { spawnSync } from "child_process";
import * as fs from "fs";

export class TDDRunner {
  public static run(
    cwd: string,
    testCommand: string,
  ): {
    success: boolean;
    failures: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  } {
    const parts: string[] = [];
    const regex = /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s]+/g;
    let match;
    while ((match = regex.exec(testCommand)) !== null) {
      let part = match[0];
      if (part.startsWith('"') && part.endsWith('"')) {
        part = part.slice(1, -1).replace(/\\"/g, '"');
      } else if (part.startsWith("'") && part.endsWith("'")) {
        part = part.slice(1, -1).replace(/\\'/g, "'");
      }
      parts.push(part);
    }
    const cmd = parts[0] || "";
    const args = parts.slice(1);

    let stdoutAccum = "";
    let stderrAccum = "";
    const failures: string[] = [];
    let success = true;
    let exitCode = 0;

    // Expanded: catches assertion failures (Expected/Received), framework markers, and common error keywords.
    const failLineRegex =
      /(FAIL\b|failing|Error:|Exception|failed\b|AssertionError|Expected|Received|✕|×|●|FAILED)/i;

    try {
      const child = spawnSync(cmd, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: true,
        timeout: 10000,
        encoding: "utf-8",
      });
      if (child.error) {
        success = false;
        failures.push(`Subprocess run error: ${child.error.message}`);
      }

      stdoutAccum = child.stdout || "";
      stderrAccum = child.stderr || "";
      exitCode = child.status !== null ? child.status : 1;

      if (exitCode !== 0) {
        success = false;
        const allLines = (stdoutAccum + "\n" + stderrAccum).split("\n");
        let captureRemaining = 0;

        const syntaxErrorRegex = /(SyntaxError|ParseError|TS\d{4}:|Compilation failed|Unexpected token)/i;
        const logicErrorRegex = /(FAIL\b|failing|Error:|Exception|failed\b|AssertionError|Expected|Received|✕|×|●|FAILED)/i;

        for (const line of allLines) {
          if (syntaxErrorRegex.test(line)) {
            failures.push("[Syntax/Compile Error] " + line.trimEnd());
            captureRemaining = 5;
          } else if (logicErrorRegex.test(line)) {
            failures.push("[Logic/Assertion Error] " + line.trimEnd());
            captureRemaining = 5;
          } else if (captureRemaining > 0) {
            if (line.trim()) {
              failures.push("  " + line.trimEnd());
            }
            captureRemaining--;
          }
        }

        if (failures.length === 0) {
          const nonEmptyLines = allLines.filter(l => l.trim().length > 0);
          failures.push(...nonEmptyLines.slice(-5).map(l => "  " + l.trimEnd()));
        }
      } else {
        success = true;
      }
    } catch (e: unknown) {
      success = false;
      const message = e instanceof Error ? e.message : String(e);
      failures.push(message || "Failed to execute test command execution");
    }

    return {
      success,
      failures: failures.slice(0, 30),
      exitCode,
      stdout: stdoutAccum,
      stderr: stderrAccum,
    };
  }
}
