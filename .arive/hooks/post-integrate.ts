#!/usr/bin/env bun
// ARIVE post-integrate hook
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  if (context.taskId) {
    console.log(`[post-integrate] Hook completed for task: ${context.taskId}`);
  }
} catch {}
process.exit(0);