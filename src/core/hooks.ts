import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  DocHookConfig,
  GuardRuleConfig,
  HookAction,
  HookScope,
  HooksConfig,
} from "./config.js";
import { runCommand } from "./exec.js";
import type { JsonObject } from "./results.js";

export interface HookViolation {
  rule: string;
  action: HookAction;
  guidance: string;
  /** First matched text, capped so a match cannot echo a whole payload back. */
  match: string;
}

export interface HookOutcome {
  violations: HookViolation[];
  blocked: boolean;
  /** Conditions that could not be evaluated; never silent, never fatal. */
  degraded: string[];
  scannedChars: number;
}

export interface HookStats {
  enabled: boolean;
  guards: number;
  docs: number;
  checks: number;
  blocked: number;
  warned: number;
  astChecks: number;
  astErrors: number;
}

interface CompiledGuard {
  rule: GuardRuleConfig;
  condition?: RegExp;
  tool?: RegExp;
}

interface CompiledDoc {
  doc: DocHookConfig;
  tool: RegExp;
}

const MAX_MATCH_CHARS = 200;

function emptyOutcome(): HookOutcome {
  return { violations: [], blocked: false, degraded: [], scannedChars: 0 };
}

/**
 * TTSR-style guard rules and doc injection at the tool boundary.
 *
 * The gateway never sees the model's token stream, so it cannot abort
 * generation. It enforces the equivalent at the boundary it owns: a call whose
 * arguments match a blocking rule returns that rule's guidance and the tool
 * does not run. The same rules are exposed as text checks so a client can
 * validate generated text before committing it.
 */
export class HookEngine {
  private readonly config: HooksConfig;
  private readonly guards: CompiledGuard[];
  private readonly docs: CompiledDoc[];
  private readonly run: typeof runCommand;
  private checks = 0;
  private blockedCount = 0;
  private warnedCount = 0;
  private astChecks = 0;
  private astErrors = 0;

  constructor(config: HooksConfig, deps?: { run?: typeof runCommand }) {
    this.config = config;
    this.run = deps?.run ?? runCommand;
    // Compiled once, without the `g` flag: a stateful lastIndex would make
    // consecutive checks on the same text alternate between match and miss.
    this.guards = config.guards.map((rule) => ({
      rule,
      ...(rule.condition !== undefined
        ? { condition: new RegExp(rule.condition) }
        : {}),
      ...(rule.tool !== undefined ? { tool: new RegExp(rule.tool) } : {}),
    }));
    this.docs = config.docs.map((doc) => ({
      doc,
      tool: new RegExp(doc.tool),
    }));
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  describe(): Array<{
    id: string;
    scope: HookScope;
    action: HookAction;
    description?: string;
  }> {
    return this.config.guards.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      action: rule.action,
      ...(rule.description ? { description: rule.description } : {}),
    }));
  }

  /** Evaluates argument-scope rules before a tool call runs. */
  async checkCall(tool: string, args: JsonObject): Promise<HookOutcome> {
    this.checks += 1;
    const outcome = emptyOutcome();
    if (!this.enabled || this.guards.length === 0) return outcome;

    const serialized = JSON.stringify(args);
    const scanned = serialized.slice(0, this.config.maxScanChars);
    outcome.scannedChars = scanned.length;

    for (const guard of this.guards) {
      if (guard.rule.scope === "text") continue;
      if (guard.tool && !guard.tool.test(tool)) continue;
      if (!guard.condition) continue;
      const found = guard.condition.exec(scanned);
      if (!found) continue;
      outcome.violations.push({
        rule: guard.rule.id,
        action: guard.rule.action,
        guidance: guard.rule.guidance,
        match: found[0].slice(0, MAX_MATCH_CHARS),
      });
    }

    return this.finish(outcome);
  }

  /** Evaluates text-scope rules against supplied text. */
  async checkText(text: string, tool?: string): Promise<HookOutcome> {
    this.checks += 1;
    const outcome = emptyOutcome();
    if (!this.enabled || this.guards.length === 0) return outcome;

    const scanned = text.slice(0, this.config.maxScanChars);
    outcome.scannedChars = scanned.length;

    for (const guard of this.guards) {
      if (guard.rule.scope === "args") continue;
      if (tool !== undefined && guard.tool && !guard.tool.test(tool)) continue;
      if (!guard.condition) continue;
      const found = guard.condition.exec(scanned);
      if (!found) continue;
      outcome.violations.push({
        rule: guard.rule.id,
        action: guard.rule.action,
        guidance: guard.rule.guidance,
        match: found[0].slice(0, MAX_MATCH_CHARS),
      });
    }

    return this.finish(outcome);
  }

  /**
   * Appends warn guidance and doc snippets to a result. Returns the input
   * object unchanged when there is nothing to add, so a compressed result is
   * never reallocated for no reason.
   */
  annotate(
    tool: string,
    result: CallToolResult,
    outcome?: HookOutcome,
  ): CallToolResult {
    if (!this.enabled) return result;

    const blocks: Array<{ type: "text"; text: string }> = [];
    for (const violation of outcome?.violations ?? []) {
      if (violation.action !== "warn") continue;
      blocks.push({
        type: "text",
        text: `<arive-hook rule="${violation.rule}">\n${violation.guidance}\n</arive-hook>`,
      });
    }

    // Documentation for a failed call is noise: the error is the message.
    if (!result.isError) {
      for (const entry of this.docs) {
        if (!entry.tool.test(tool)) continue;
        const title = entry.doc.title ?? entry.doc.id;
        blocks.push({
          type: "text",
          text: `<arive-doc id="${entry.doc.id}" title="${title}">\n${entry.doc.text}\n</arive-doc>`,
        });
      }
    }

    if (blocks.length === 0) return result;
    return { ...result, content: [...result.content, ...blocks] };
  }

  stats(): HookStats {
    return {
      enabled: this.config.enabled,
      guards: this.config.guards.length,
      docs: this.config.docs.length,
      checks: this.checks,
      blocked: this.blockedCount,
      warned: this.warnedCount,
      astChecks: this.astChecks,
      astErrors: this.astErrors,
    };
  }

  private finish(outcome: HookOutcome): HookOutcome {
    outcome.blocked = outcome.violations.some(
      (violation) => violation.action === "block",
    );
    // Counters are per evaluated outcome, not per matching rule.
    if (outcome.blocked) this.blockedCount += 1;
    else if (outcome.violations.length > 0) this.warnedCount += 1;
    return outcome;
  }
}

/** The error a blocked call returns instead of executing the tool. */
export function blockedResult(outcome: HookOutcome): CallToolResult {
  const violation =
    outcome.violations.find((entry) => entry.action === "block") ??
    outcome.violations[0];

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: `Blocked by guard rule "${violation?.rule}": ${violation?.guidance}`,
            rule: violation?.rule,
            executed: false,
            retry: true,
            violations: outcome.violations,
            ...(outcome.degraded.length ? { degraded: outcome.degraded } : {}),
          },
          null,
          2,
        ),
      },
      {
        type: "text",
        text: `<system-reminder>\n${violation?.guidance}\n</system-reminder>`,
      },
    ],
  };
}
