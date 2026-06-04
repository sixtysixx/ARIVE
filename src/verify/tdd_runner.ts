import { SubagentRunner } from "../integrate/subagent_runner.js";

export class TDDRunner {
  public static run(cwd: string, testCommand: string): { success: boolean; failures: string[]; output: string } {
    const result = SubagentRunner.execute(cwd, testCommand);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const failures = this.parseFailures(combinedOutput);

    return {
      success: result.exitCode === 0 && failures.length === 0,
      failures,
      output: combinedOutput
    };
  }

  public static parseFailures(output: string): string[] {
    const lines = output.split("\n");
    const failures: string[] = [];

    // Detect failure signatures from common runners (bun, jest, pytest, cargo)
    for (const line of lines) {
      const trimmed = line.trim();
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
