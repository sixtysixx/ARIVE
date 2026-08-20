#!/usr/bin/env bun
// ARIVE post-reason hook: Fable method completion verification check
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
const resultStr = process.env.ARIVE_HOOK_RESULT || "{}";
try {
  const context = JSON.parse(contextStr);
  const result = JSON.parse(resultStr);
  if (context.thoughtNumber && context.totalThoughts && context.thoughtNumber === context.totalThoughts) {
    console.error(`[fable-hook] Reasoning sequence reaching final thought (${context.thoughtNumber}/${context.totalThoughts}). Verify definitions of done.`);
  }
} catch {
  // Pass-through
}
process.exit(0);
