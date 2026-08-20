#!/usr/bin/env bun
// ARIVE post-verify hook: Fable-Judge verification pass
const resultStr = process.env.ARIVE_HOOK_RESULT || "{}";
try {
  const result = JSON.parse(resultStr);
  if (result.success) {
    console.error("[fable-judge] Verification succeeded: tests passed.");
  } else if (result.failures && result.failures.length > 0) {
    console.error(`[fable-judge] Verification failed: ${result.failures.length} test failure(s) detected.`);
  }
} catch {
  // Pass-through
}
process.exit(0);
