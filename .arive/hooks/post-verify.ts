#!/usr/bin/env bun
// ARIVE post-verify hook: Verification Judge evaluation and report logging
import * as fs from "fs";
import * as path from "path";

const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
const resultStr = process.env.ARIVE_HOOK_RESULT || "{}";

try {
  const context = JSON.parse(contextStr);
  const result = JSON.parse(resultStr);
  const taskId = String(context.taskId || "default");

  const isSuccess = Boolean(result.success);
  const failureCount = Array.isArray(result.failures) ? result.failures.length : 0;

  if (isSuccess) {
    console.error(`[arive-judge] Verification PASSED for task "${taskId}".`);
  } else {
    console.error(`[arive-judge] Verification FAILED for task "${taskId}": ${failureCount} failure(s).`);
  }

  // Record verification outcome
  const stateDir = path.resolve(".arive");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const statusFile = path.resolve(stateDir, "verification_status.json");
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        taskId,
        success: isSuccess,
        failureCount,
        testCommand: context.testCommand || null,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
} catch (e: unknown) {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[arive-judge] post-verify processing error: ${err}`);
}
process.exit(0);
