import { SubagentRunner } from "../integrate/subagent_runner.js";

export class TDDRunner {
  public static run(cwd: string, testCommand: string): { success: boolean; failures: string[]; output: string } {
    try {
      const result = SubagentRunner.execute(cwd, testCommand);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      const failures = this.parseFailures(combinedOutput);

      return {
        success: result.exitCode === 0 && failures.length === 0,
        failures,
        output: combinedOutput
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        failures: [message],
        output: `Runner Execution Failure: ${message}`
      };
    }
  }

  public static parseFailures(output: string): string[] {
    if (!output || typeof output !== "string") {
      return [];
    }

    // Safety: limit total output size to process to prevent OOM
    const maxOutputLength = 1024 * 1024; // 1 MB
    const targetOutput = output.length > maxOutputLength ? output.slice(0, maxOutputLength) : output;

    const lines = targetOutput.slice().split("\n");
    const failures: string[] = [];

    // Safety: limit maximum line length and total failures captured to prevent performance/memory degradation
    const maxLineLength = 2048;
    const maxFailures = 100;

    for (let i = 0; i < lines.length; i++) {
      if (failures.length >= maxFailures) {
        break;
      }

      let line = lines[i];
      if (line.length > maxLineLength) {
        // Truncate line instead of skipping, so we can still detect failure signatures
        line = line.slice(0, maxLineLength);
      }

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      // Detect failure signatures from common runners (bun, jest, pytest, cargo)
      if (
        (trimmed.startsWith("FAIL") && !/^FAIL\s+\S+$/.test(trimmed)) ||
        trimmed.includes("Error:") ||
        trimmed.includes("Exception:") ||
        trimmed.startsWith("assertion failed") ||
        trimmed.startsWith("failed:")
      ) {
        failures.push(trimmed);
      }
    }

    return failures;
  }
}
