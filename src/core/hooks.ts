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
  /** A matched rule (`violation`) is different from a rule that could not run. */
  kind: "violation" | "unevaluated";
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
  /** Blocks where at least one rule could not run; a subset of `blocked`. */
  unevaluated: number;
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

/** Result of one `sg` process, before it is attributed to a rule. */
type AstExec =
  | { kind: "ok"; matched: boolean }
  | { kind: "timeout" }
  | { kind: "missing" }
  | { kind: "failed"; detail: string };

const MAX_MATCH_CHARS = 200;
/** ast-grep's stderr when the pattern itself is not a valid AST. */
const AST_PATTERN_WARNING = /^Warning: .*ERROR node/m;
const MAX_AST_DEPTH = 8;
const MAX_AST_TEXTS = 50;

/** Every string leaf of a JSON value, labelled by its path. */
function stringLeaves(
  value: unknown,
  label: string,
  out: Array<{ label: string; text: string }>,
  skipped: string[],
  depth = 0,
): void {
  if (out.length >= MAX_AST_TEXTS) return;
  if (typeof value === "string") {
    if (value !== "") out.push({ label, text: value });
    return;
  }
  if (depth >= MAX_AST_DEPTH) {
    skipped.push(
      `argument "${label}" is nested deeper than ${MAX_AST_DEPTH} levels; astCondition rules skipped it`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      stringLeaves(entry, `${label}[${index}]`, out, skipped, depth + 1),
    );
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      stringLeaves(entry, `${label}.${key}`, out, skipped, depth + 1);
    }
  }
}

function emptyOutcome(): HookOutcome {
  return { violations: [], blocked: false, degraded: [], scannedChars: 0 };
}

/** Number of ast-grep matches in `--json=compact` output, or undefined. */
function parseAstCount(stdout: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The first stderr line that says something. `sg` wrappers prepend a
 * deprecation banner, and a rule's degrade reason must be the diagnosis, not
 * the banner.
 */
function firstDiagnostic(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !/^[=\-*]+$/.test(line) &&
        !/`?sg`? is deprecated/i.test(line),
    );
  const diagnostic =
    lines.find((line) => /^(Warning|Error): /i.test(line)) ?? lines[0] ?? "";
  return diagnostic.slice(0, 300);
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
  private unevaluatedCount = 0;
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

    // A regex sees the serialized arguments, so the AST subjects must cover
    // every string leaf, not just top-level values, or a nested payload is
    // scanned by one rule and silently skipped by the other.
    const astTexts: Array<{ label: string; text: string }> = [];
    const skippedLeaves: string[] = [];
    const hasAstRule = this.guards.some(
      (guard) => guard.rule.scope !== "text" && guard.rule.astCondition !== undefined,
    );
    if (hasAstRule) {
      stringLeaves(args, "args", astTexts, skippedLeaves);
      if (astTexts.length >= MAX_AST_TEXTS) {
        skippedLeaves.push(
          `more than ${MAX_AST_TEXTS} string arguments; astCondition rules scanned the first ${MAX_AST_TEXTS}`,
        );
      }
      outcome.degraded.push(...skippedLeaves);
    }
    const cache = new Map<string, AstExec>();

    for (const guard of this.guards) {
      if (guard.rule.scope === "text") continue;
      if (guard.tool && !guard.tool.test(tool)) continue;
      const violation = await this.evaluate(guard, scanned, astTexts, cache, outcome);
      if (violation) outcome.violations.push(violation);
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
    // The regex subject is capped, but evaluation needs the real length so
    // `evaluate` can degrade on it instead of silently parsing a prefix.
    const astTexts = [{ label: "text", text }];
    const cache = new Map<string, AstExec>();

    for (const guard of this.guards) {
      if (guard.rule.scope === "args") continue;
      if (tool !== undefined && guard.tool && !guard.tool.test(tool)) continue;
      const violation = await this.evaluate(guard, scanned, astTexts, cache, outcome);
      if (violation) outcome.violations.push(violation);
    }

    return this.finish(outcome);
  }

  /**
   * Applies one rule to one subject. A rule contributes at most one violation:
   * a regex hit answers the rule without running `sg` at all.
   */
  private async evaluate(
    guard: CompiledGuard,
    regexText: string,
    astTexts: Array<{ label: string; text: string }>,
    cache: Map<string, AstExec>,
    outcome: HookOutcome,
  ): Promise<HookViolation | undefined> {
    const rule = guard.rule;
    if (guard.condition) {
      const found = guard.condition.exec(regexText);
      if (found) {
        return {
          rule: rule.id,
          action: rule.action,
          kind: "violation",
          guidance: rule.guidance,
          match: found[0].slice(0, MAX_MATCH_CHARS),
        };
      }
    }
    if (!rule.astCondition) return undefined;

    for (const entry of astTexts) {
      if (entry.text.length > this.config.maxScanChars) {
        outcome.degraded.push(
          `argument "${entry.label}" exceeds hooks.maxScanChars; astCondition rule "${rule.id}" skipped`,
        );
        continue;
      }
      const executed = await this.astMatch(rule, entry.text, cache);
      if (executed.kind !== "ok") {
        const reason = this.astReason(rule, executed);
        outcome.degraded.push(reason);
        this.astErrors += 1;
        // Fail closed only when the deployment asked for it.
        if (this.config.onAstError === "block") {
          return {
            rule: rule.id,
            action: "block",
            kind: "unevaluated",
            guidance: `Guard rule ${rule.id} could not be evaluated: ${reason}`,
            match: "",
          };
        }
        continue;
      }
      if (executed.matched) {
        return {
          rule: rule.id,
          action: rule.action,
          kind: "violation",
          guidance: rule.guidance,
          match: entry.text.trim().slice(0, MAX_MATCH_CHARS),
        };
      }
    }
    return undefined;
  }

  /**
   * Runs `sg` once per (pattern, text) pair inside a single check. The text is
   * part of the key: sharing a result across different arguments would apply a
   * match to text that was never parsed.
   */
  private async astMatch(
    rule: GuardRuleConfig,
    text: string,
    cache: Map<string, AstExec>,
  ): Promise<AstExec> {
    const ast = rule.astCondition!;
    const key = [
      ast.pattern,
      ast.lang,
      ast.selector ?? "",
      ast.strictness ?? "",
      text,
    ].join("\u0000");
    const cached = cache.get(key);
    if (cached) return cached;

    const args = [
      "run",
      "--pattern",
      ast.pattern,
      "--lang",
      ast.lang,
      "--stdin",
      "--json=compact",
    ];
    if (ast.selector) args.push("--selector", ast.selector);
    if (ast.strictness) args.push("--strictness", ast.strictness);

    this.astChecks += 1;
    const result = await this.run("sg", args, {
      stdin: text,
      timeoutMs: this.config.astTimeoutMs,
      maxBytes: 2_000_000,
    });

    let executed: AstExec;
    if (result.outcome === "timeout") {
      executed = { kind: "timeout" };
    } else if (result.outcome === "spawnError") {
      executed = { kind: "missing" };
    } else if (result.code === 0 || result.code === 1) {
      // A match exits 0 with a JSON array, no match exits 1 with `[]`, and a
      // malformed pattern exits 0 with `[]` plus a warning on stderr.
      const count = parseAstCount(result.stdout);
      if (count === undefined) {
        executed = { kind: "failed", detail: firstDiagnostic(result.stderr) };
      } else if (AST_PATTERN_WARNING.test(result.stderr)) {
        // The parse succeeded but the pattern is unusable, so it would pass
        // silently forever. Report it instead.
        executed = { kind: "failed", detail: firstDiagnostic(result.stderr) };
      } else {
        executed = { kind: "ok", matched: count > 0 };
      }
    } else {
      executed = { kind: "failed", detail: firstDiagnostic(result.stderr) };
    }

    cache.set(key, executed);
    return executed;
  }

  /** Names the rule and the failure, because a degrade must be actionable. */
  private astReason(rule: GuardRuleConfig, executed: AstExec): string {
    switch (executed.kind) {
      case "timeout":
        return `ast-grep timed out after ${this.config.astTimeoutMs}ms for guard rule "${rule.id}"`;
      case "missing":
        return `ast-grep (sg) is not runnable for guard rule "${rule.id}"; install ast-grep and ensure it is on PATH`;
      case "failed":
        return `ast-grep failed for guard rule "${rule.id}": ${executed.detail}`;
      default:
        return `ast-grep could not evaluate guard rule "${rule.id}"`;
    }
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

    // A guard that could not run is a finding, not a pass: say so on the result
    // even when no rule matched.
    for (const reason of outcome?.degraded ?? []) {
      blocks.push({
        type: "text",
        text: `<arive-hook degraded="true">\n${reason}\n</arive-hook>`,
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
      unevaluated: this.unevaluatedCount,
      warned: this.warnedCount,
      astChecks: this.astChecks,
      astErrors: this.astErrors,
    };
  }

  private finish(outcome: HookOutcome): HookOutcome {
    const blocking = outcome.violations.filter(
      (violation) => violation.action === "block",
    );
    outcome.blocked = blocking.length > 0;
    // Counters are per evaluated outcome, not per matching rule. A block that
    // only exists because a rule could not run is not proof the policy held.
    if (blocking.some((violation) => violation.kind === "unevaluated")) {
      this.unevaluatedCount += 1;
    }
    if (blocking.some((violation) => violation.kind === "violation")) {
      this.blockedCount += 1;
    }
    if (!outcome.blocked && outcome.violations.length > 0) {
      this.warnedCount += 1;
    }
    return outcome;
  }
}

/** The error a blocked call returns instead of executing the tool. */
export function blockedResult(outcome: HookOutcome): CallToolResult {
  const violation =
    outcome.violations.find((entry) => entry.action === "block") ??
    outcome.violations[0];

  const kind = violation?.kind ?? "violation";

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error:
              kind === "unevaluated"
                ? `Guard rule "${violation?.rule}" could not be evaluated: ${violation?.guidance}`
                : `Blocked by guard rule "${violation?.rule}": ${violation?.guidance}`,
            rule: violation?.rule,
            kind,
            executed: false,
            // Retrying cannot fix an unavailable evaluator; it can fix a match.
            retry: kind === "violation",
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
