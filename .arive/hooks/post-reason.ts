#!/usr/bin/env bun
// ARIVE post-reason hook: Evaluates reasoning sequence progress and defined done verification
import * as fs from "fs";
import * as path from "path";

const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
const resultStr = process.env.ARIVE_HOOK_RESULT || "{}";

try {
  const context = JSON.parse(contextStr);
  const result = JSON.parse(resultStr);
  const tNum = Number(context.thoughtNumber || 0);
  const total = Number(context.totalThoughts || 0);

  if (tNum > 0 && total > 0 && tNum === total) {
    console.error(`[arive-hook] Reasoning sequence completed (${tNum}/${total}).`);
    if (context.definedDone) {
      console.error(`[arive-hook] Defined done criteria: "${context.definedDone}"`);
    } else {
      console.error("[arive-hook] Warning: Reasoning sequence finalized without explicit definedDone criteria.");
    }
  }

  // Record reasoning progress state
  const stateDir = path.resolve(".arive");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const statusFile = path.resolve(stateDir, "reasoning_status.json");
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        lastThoughtNumber: tNum,
        totalThoughts: total,
        sessionId: context.sessionId || "default",
        definedDone: context.definedDone || null,
        updatedAt: new Date().toISOString(),
        activeThoughtCount: result.activeThoughtCount || tNum,
      },
      null,
      2
    ),
    "utf-8"
  );
} catch (e: unknown) {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[arive-hook] post-reason processing error: ${err}`);
}
process.exit(0);
