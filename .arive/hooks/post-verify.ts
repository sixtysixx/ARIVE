#!/usr/bin/env bun
// ARIVE post-verify hook: ARIVE Verification Judge pass
const resultStr = process.env.ARIVE_HOOK_RESULT || "{}";
try {
  const result = JSON.parse(resultStr);
  if (result.success) {
    console.error("[arive-judge] Verification succeeded: tests passed.");
  } else if (result.failures && result.failures.length > 0) {
    console.error(`[arive-judge] Verification failed: ${result.failures.length} test failure(s) detected.`);
  }
} catch {
  // Pass-through
}
process.exit(0);
