#!/usr/bin/env bun
// ARIVE pre-verify hook: Fable method named verification prep
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  if (context.taskId) {
    console.error(`[fable-hook] Initiating named verification for task ${context.taskId}`);
  }
} catch {
  // Pass-through
}
process.exit(0);
