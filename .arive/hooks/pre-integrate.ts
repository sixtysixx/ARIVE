#!/usr/bin/env bun
// ARIVE pre-integrate hook
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  if (context.taskId) {
    console.log(`[pre-integrate] Hook started for task: ${context.taskId}`);
  }
} catch {}
process.exit(0);