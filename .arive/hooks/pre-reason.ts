#!/usr/bin/env bun
// ARIVE pre-reason hook: Fable method ask classification and intent check
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  if (context.thought) {
    const thoughtLower = context.thought.toLowerCase();
    if (thoughtLower.includes("intent:")) {
      console.error("[fable-hook] INTENT gate record detected in reasoning step.");
    }
  }
} catch {
  // Pass-through
}
process.exit(0);
