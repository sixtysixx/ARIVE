import { HookManager } from "../integrate/hook_manager.js";
import { CCRRegistry } from "../analyze/ccr_registry.js";

const DEFAULT_COMPACT_THRESHOLD = 2048;

export interface CompactResult<T = unknown> {
  value: T;
  compacted: boolean;
  ref?: string;
  originalLength: number;
}

function wirePostCompactHook<T>(
  result: CompactResult<T>,
  phase: string,
  meta: Record<string, unknown>,
): void {
  try {
    HookManager.runHook("post-compact", phase, meta, result);
  } catch {
    // hook failures must not break tool returns
  }
}

export interface CompactText {
  (
    text: string,
    phase: string,
    meta: Record<string, unknown>,
    threshold?: number,
  ): string;
}

export interface CompactObject {
  <T>(
    obj: T,
    phase: string,
    meta: Record<string, unknown>,
    threshold?: number,
  ): CompactResult<T>;
}

export interface CompactHelpers {
  compactText: CompactText;
  compactObject: CompactObject;
}

export function createCompactHelpers(ccr: CCRRegistry): CompactHelpers {
  function compactText(
    text: string,
    phase: string,
    meta: Record<string, unknown>,
    threshold = DEFAULT_COMPACT_THRESHOLD,
  ): string {
    if (text.length > threshold) {
      const hash = ccr.store(text, (meta.type as string) || phase);
      const result = {
        value: `ccr:${hash}`,
        compacted: true,
        ref: `ccr:${hash}`,
        originalLength: text.length,
      };
      wirePostCompactHook(result, phase, meta);
      return result.value;
    }
    return text;
  }

  function compactObject<T>(
    obj: T,
    phase: string,
    meta: Record<string, unknown>,
    threshold = DEFAULT_COMPACT_THRESHOLD,
  ): CompactResult<T> {
    const compactText = JSON.stringify(obj);
    if (compactText.length <= threshold) {
      return {
        value: obj,
        compacted: false,
        originalLength: compactText.length,
      };
    }

    const prettyText = JSON.stringify(obj, null, 2);
    const hash = ccr.store(prettyText, "json");
    const payload = { ccr: `ccr:${hash}`, originalLength: prettyText.length };
    const result = {
      value: payload as T,
      compacted: true,
      ref: `ccr:${hash}`,
      originalLength: prettyText.length,
    };
    wirePostCompactHook(result, phase, meta);
    return result;
  }

  return { compactText, compactObject };
}
