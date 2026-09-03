#!/usr/bin/env bun
// ARIVE pre-verify hook: Verification setup and workspace pre-check
import * as fs from "fs";
import * as path from "path";

const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  const taskId = String(context.taskId || "default");
  const testCmd = String(context.testCommand || "bun test");

  console.error(`[arive-hook] Initiating verification for task "${taskId}" using "${testCmd}"`);

  const taskPath = path.resolve(".arive-tasks", taskId);
  if (fs.existsSync(taskPath)) {
    console.error(`[arive-hook] Workspace confirmed at ${taskPath}`);
  }
} catch (e: unknown) {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[arive-hook] pre-verify processing error: ${err}`);
}
process.exit(0);
