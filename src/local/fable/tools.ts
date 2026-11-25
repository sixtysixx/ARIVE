import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  optionalString,
  requireString,
  textResult,
  type JsonObject,
  type LocalTool,
} from "../../core/results.js";
import {
  FABLE_DOCS,
  FABLE_DOMAINS,
  FABLE_UPSTREAM,
  loadDoc,
  loadDomain,
  type FableDocKey,
} from "./content.js";

const METHOD_MODES = Object.keys(FABLE_DOCS);
const CLASSIFICATIONS = ["question", "task", "plan-first"] as const;
const RESULTS = ["confirmed", "unverified", "contradicted"] as const;

type ClaimResult = (typeof RESULTS)[number];

/** A changed file inside a test tree or named like a test: a check got weakened. */
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|specs?)(\/|$)|\.(test|spec)\.[^/]+$/;
/** Files that should never be part of finished work. */
const DEBRIS_RE = /(^|\/)(\.DS_Store|.*\.(orig|rej)|scratch[^/]*|tmp[^/]*|.*~)$/i;

interface Finding {
  fraud: string;
  detail?: string;
  files?: string[];
}

interface JudgeClaim {
  claim: string;
  result: ClaimResult;
  evidence: string;
}

const HEADER =
  `fable-method v${FABLE_UPSTREAM.version} (${FABLE_UPSTREAM.license}, ${FABLE_UPSTREAM.repo}@9924067e). ` +
  "ARIVE mapping: fable_plan builds the plan artifact, fable_judge verdicts finished work, and domain=<sector> appends that sector's adapter.";

function objectArray(field: string, value: unknown[]): JsonObject[] {
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    return entry as JsonObject;
  });
}

function optionalObjects(args: JsonObject, field: string): JsonObject[] {
  const value = args[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return objectArray(field, value);
}

function optionalStrings(args: JsonObject, field: string): string[] {
  const value = args[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalObject(args: JsonObject, field: string): JsonObject {
  const value = args[field];
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as JsonObject;
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

function underScope(file: string, scope: string[]): boolean {
  return scope.some(
    (entry) => file === entry || file.startsWith(entry.replace(/\/+$/, "") + "/"),
  );
}

function fableMethodTool(): LocalTool {
  return {
    name: "fable_method",
    compressible: false,
    description:
      "[FABLE] Load the fable-method rules: the classify → define done → gather evidence → decide → act → verify → report loop, its deep references, the orchestrated loop/judge/domain skills, or one of eight domain adapters.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: [...METHOD_MODES],
          description: "Which document to load; method is the whole ruleset.",
        },
        domain: {
          type: "string",
          enum: [...FABLE_DOMAINS],
          description: "Append this sector's adapter to the loaded document.",
        },
      },
    },
    handler: (args): CallToolResult => {
      const mode = optionalString(args, "mode") ?? "method";
      if (!Object.hasOwn(FABLE_DOCS, mode)) {
        throw new Error(`mode must be one of ${METHOD_MODES.join(", ")}`);
      }
      let body = loadDoc(mode as FableDocKey);
      const domain = optionalString(args, "domain");
      if (domain !== undefined) {
        body += "\n\n---\n\n" + loadDomain(domain);
      }
      return textResult(`${HEADER}\n\n${body}`);
    },
  };
}

function fablePlanTool(): LocalTool {
  return {
    name: "fable_plan",
    compressible: false,
    description:
      "[FABLE] Turn a classified ask into the method's plan artifact: definition of done with its named verification, cited evidence, one recommendation, declared scope, and a checklist. Validation failures return the artifact plus the missing fields; nothing is written.",
    inputSchema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: [...CLASSIFICATIONS],
          description:
            "question (assessment only), task (do it), or plan-first (stop after the plan).",
        },
        task: { type: "string", description: "The ask, in one line." },
        done: {
          type: "string",
          description: "One sentence: what done looks like.",
        },
        verification: {
          type: "string",
          description:
            "The observation that proves done: a command, a count, a rendered page.",
        },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              finding: { type: "string" },
            },
            required: ["source", "finding"],
          },
        },
        recommendation: {
          type: "string",
          description: "The one course of action you would take.",
        },
        alternatives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              option: { type: "string" },
              whyRejected: { type: "string" },
            },
            required: ["option", "whyRejected"],
          },
        },
        scope: {
          type: "array",
          items: { type: "string" },
          description: "Files or areas this change is allowed to touch.",
        },
        assumptions: { type: "array", items: { type: "string" } },
      },
      required: ["classification"],
    },
    handler: (args): CallToolResult => {
      const classification = requireString(
        args,
        "classification",
        "fable_plan",
      );
      if (!(CLASSIFICATIONS as readonly string[]).includes(classification)) {
        throw new Error(
          `classification must be one of ${CLASSIFICATIONS.join(", ")}`,
        );
      }

      const task = optionalString(args, "task") ?? "";
      const done = optionalString(args, "done") ?? "";
      const verification = optionalString(args, "verification");
      const recommendation = optionalString(args, "recommendation");
      const evidence = optionalObjects(args, "evidence").map((entry, index) => {
        const source = optionalString(entry, "source");
        const finding = optionalString(entry, "finding");
        if (!source || !finding) {
          throw new Error(`evidence[${index}] needs source and finding`);
        }
        return { source, finding };
      });
      const alternatives = optionalObjects(args, "alternatives").map(
        (entry) => ({
          option: optionalString(entry, "option") ?? "",
          whyRejected: optionalString(entry, "whyRejected") ?? "",
        }),
      );
      const scope = optionalStrings(args, "scope");
      const assumptions = optionalStrings(args, "assumptions");

      const missing: string[] = [];
      if (task === "") missing.push("task");
      if (done === "") missing.push("done");
      if (classification === "task" || classification === "plan-first") {
        if (verification === undefined) missing.push("verification");
        if (recommendation === undefined) missing.push("recommendation");
      }
      if (classification === "plan-first" && scope.length === 0) {
        missing.push("scope");
      }

      const stop = classification === "plan-first";
      const lines: string[] = [];
      lines.push(`# Plan: ${task === "" ? "(unspecified)" : task}`);
      lines.push("## Classification");
      lines.push(classification);
      lines.push("## Done");
      lines.push(done === "" ? "(not stated)" : done);
      lines.push(`Verify: ${verification ?? "not named"}`);
      lines.push("## Evidence");
      if (evidence.length === 0) lines.push("- none gathered");
      for (const entry of evidence) {
        lines.push(`- ${entry.source}: ${entry.finding}`);
      }
      lines.push("## Recommendation");
      lines.push(recommendation ?? "(none)");
      for (const entry of alternatives) {
        lines.push(`- ${entry.option} — rejected: ${entry.whyRejected}`);
      }
      lines.push("## Scope");
      if (scope.length === 0) lines.push("- (not declared)");
      for (const item of scope) lines.push(`- ${item}`);
      lines.push("## Assumptions");
      if (assumptions.length === 0) lines.push("- (none stated)");
      for (const item of assumptions) lines.push(`- ${item}`);
      lines.push("## Checklist");
      if (scope.length > 0) {
        for (const item of scope) lines.push(`- [ ] ${item}`);
      } else if (recommendation !== undefined) {
        lines.push(`- [ ] ${recommendation}`);
      } else {
        lines.push("- [ ] define the change");
      }
      if (missing.length > 0) {
        lines.push("## Missing");
        for (const field of missing) lines.push(`- ${field}`);
      }
      lines.push(
        stop
          ? "> Stop here: present this plan and wait for approval."
          : classification === "question"
            ? "> Change nothing: this is an assessment."
            : "> Act only inside the declared scope; verify by observation before reporting.",
      );

      return textResult({
        ok: missing.length === 0,
        missing,
        stop,
        artifact: lines.join("\n"),
      });
    },
  };
}

function fableJudgeTool(): LocalTool {
  return {
    name: "fable_judge",
    compressible: false,
    description:
      "[FABLE] Adversarial judge for finished work. Pass each claim with what you actually observed; returns VERIFIED / VERIFIED WITH CAVEATS / REFUTED, the frauds visible in the facts you supply, and the report lines the method requires. The gateway executes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              result: { type: "string", enum: [...RESULTS] },
              evidence: { type: "string" },
            },
            required: ["claim"],
          },
        },
        changedFiles: { type: "array", items: { type: "string" } },
        declaredScope: { type: "array", items: { type: "string" } },
        outwardActions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              authQuote: { type: "string" },
            },
            required: ["action"],
          },
        },
        report: {
          type: "object",
          properties: {
            behaviorChanged: { type: "boolean" },
            fixedDefect: { type: "boolean" },
            pendingFollowUp: { type: "string" },
          },
        },
      },
      required: ["claims"],
    },
    handler: (args): CallToolResult => {
      const rawClaims = args.claims;
      if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
        throw new Error("claims must be a non-empty array");
      }
      const claims: JudgeClaim[] = objectArray("claims", rawClaims).map(
        (entry) => {
          const claim = optionalString(entry, "claim") ?? "";
          const raw = optionalString(entry, "result") ?? "unverified";
          if (!(RESULTS as readonly string[]).includes(raw)) {
            throw new Error(
              "result must be confirmed, unverified, or contradicted",
            );
          }
          return {
            claim,
            result: raw as ClaimResult,
            evidence: optionalString(entry, "evidence") ?? "",
          };
        },
      );

      const changedFiles = optionalStrings(args, "changedFiles").map(
        normalizePath,
      );
      const declaredScope = optionalStrings(args, "declaredScope").map(
        normalizePath,
      );
      const outwardActions = optionalObjects(args, "outwardActions").map(
        (entry) => ({
          action: optionalString(entry, "action") ?? "",
          authQuote: optionalString(entry, "authQuote"),
        }),
      );
      const report = optionalObject(args, "report");

      const findings: Finding[] = [];
      for (const entry of claims) {
        if (entry.result === "contradicted") {
          findings.push({
            fraud: "refuted-claim",
            detail:
              entry.evidence === ""
                ? `${entry.claim}: no evidence given`
                : `${entry.claim}: ${entry.evidence}`,
          });
        } else if (entry.result === "unverified") {
          findings.push({
            fraud: "unverifiable",
            detail: `${entry.claim}: not reproduced; report it as a caveat`,
          });
        }
      }

      const weakened = changedFiles.filter((file) => TEST_PATH_RE.test(file));
      if (weakened.length > 0) {
        findings.push({ fraud: "weakened-check", files: weakened });
      }

      if (declaredScope.length > 0) {
        const outside = changedFiles.filter(
          (file) => !underScope(file, declaredScope),
        );
        if (outside.length > 0) {
          findings.push({ fraud: "scope-creep", files: outside });
        }
      }

      for (const entry of outwardActions) {
        if (!entry.authQuote) {
          findings.push({
            fraud: "unauthorized-action",
            detail: entry.action,
          });
        }
      }

      const debris = changedFiles.filter((file) => DEBRIS_RE.test(file));
      if (debris.length > 0) {
        findings.push({ fraud: "debris", files: debris });
      }

      const refuted = findings.some(
        (finding) =>
          finding.fraud === "refuted-claim" ||
          finding.fraud === "unauthorized-action",
      );
      const verdict = refuted
        ? "REFUTED"
        : findings.length > 0
          ? "VERIFIED WITH CAVEATS"
          : "VERIFIED";
      const action = refuted
        ? "fix: address the refuted claim or unauthorized action before shipping"
        : findings.length > 0
          ? "ship with the caveats named in the report"
          : "ship; report outcome-first";

      const requiredReportLines: string[] = [];
      if (report.behaviorChanged === true) {
        requiredReportLines.push(
          "INTENT: code does <X>; the failing check/task expects <Y>; the spec says <Z>",
        );
      }
      for (const entry of outwardActions) {
        if (entry.authQuote) {
          requiredReportLines.push(`AUTH: user said "${entry.authQuote}"`);
        }
      }
      if (report.fixedDefect === true) {
        requiredReportLines.push(
          'TWINS: searched <pattern> - found <N> other sites: <files, or "none">',
        );
      }
      const pending = optionalString(report, "pendingFollowUp");
      if (pending !== undefined) {
        requiredReportLines.push(
          `PENDING: ${pending} - awaiting your authorization`,
        );
      }

      return textResult({
        verdict,
        claims,
        findings,
        requiredReportLines,
        action,
        checked: "caller-supplied observations; the gateway executed nothing",
      });
    },
  };
}

export function createFableTools(): LocalTool[] {
  return [fableMethodTool(), fablePlanTool(), fableJudgeTool()];
}
