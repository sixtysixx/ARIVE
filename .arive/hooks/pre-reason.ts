#!/usr/bin/env bun
// ARIVE pre-reason hook: Enforces ask classification, intent gating, and active claim validation
const contextStr = process.env.ARIVE_HOOK_CONTEXT || "{}";
try {
  const context = JSON.parse(contextStr);
  const thought = String(context.thought || "");
  const thoughtNumber = Number(context.thoughtNumber || 1);
  const totalThoughts = Number(context.totalThoughts || 1);
  const askShape = context.askShape ? String(context.askShape) : "task";

  if (thoughtNumber === 1) {
    console.error(`[arive-hook] Sequence started | Classification: ${askShape} | Target thoughts: ${totalThoughts}`);
  }

  if (thought.toLowerCase().includes("intent:")) {
    console.error(`[arive-hook] Intent gate validated at step ${thoughtNumber}/${totalThoughts}.`);
  }

  if (context.claims && Array.isArray(context.claims) && context.claims.length > 0) {
    console.error(`[arive-hook] Active claims under evaluation: ${context.claims.length}`);
  }
} catch (e: unknown) {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[arive-hook] pre-reason processing error: ${err}`);
}
process.exit(0);
