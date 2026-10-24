import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Namespace } from "../core/config.js";
import { errorMessage, safeJson } from "../core/log.js";
import {
  isTextBlock,
  optionalNumber,
  optionalString,
  requireString,
  textResult,
  type JsonObject,
  type LocalTool,
} from "../core/results.js";

type StepStatus = "ok" | "skipped" | "failed";

export interface PipelineStep {
  step: string;
  status: StepStatus;
  detail?: string;
}

export interface PipelineDeps {
  call: (name: string, args: JsonObject) => Promise<CallToolResult>;
  find: (namespace: Namespace, candidates: string[]) => string | undefined;
  refresh: () => Promise<void>;
}

function record(
  steps: PipelineStep[],
  step: string,
  status: StepStatus,
  detail?: string,
): void {
  steps.push({
    step,
    status,
    ...(detail
      ? { detail: detail.length > 900 ? `${detail.slice(0, 900)}…` : detail }
      : {}),
  });
}

function textOf(result: CallToolResult): string {
  const text = result.content.filter(isTextBlock).map((block) => block.text).join("\n");
  return text || safeJson(result.content);
}

function unwrap(result: CallToolResult): string {
  const text = textOf(result);
  if (result.isError) throw new Error(text);
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createPipelineTools(deps: PipelineDeps): LocalTool[] {
  return [
    {
      name: "arive_reasoned_debug",
      description:
        "[ARIVE] Combine sequential reflection with DAP inspection: reason about the symptom, set breakpoints and inspect variables when a debugger is available, then store findings in memory.",
      inputSchema: {
        type: "object",
        properties: {
          symptom: { type: "string", description: "Observed failure or question." },
          program: { type: "string", description: "Program to launch under the debugger." },
          filePath: { type: "string", description: "File to break on." },
          breakpoints: {
            type: "array",
            items: { type: "integer" },
            description: "Line numbers to break on.",
          },
          maxSteps: { type: "integer", default: 3 },
        },
        required: ["symptom"],
      },
      handler: async (args) => {
        await deps.refresh();
        const symptom = requireString(args, "symptom", "arive_reasoned_debug");
        const steps: PipelineStep[] = [];
        const maxSteps = Math.min(6, Math.max(1, optionalNumber(args, "maxSteps") ?? 3));
        const thoughts: string[] = [];

        const thinkTool = deps.find("think", [
          "sequentialthinking",
          "sequential_thinking",
          "think",
        ]);
        if (!thinkTool) {
          record(steps, "sequential_thinking", "skipped", "think namespace unavailable.");
        } else {
          for (let i = 1; i <= maxSteps; i++) {
            const thought =
              i === 1
                ? `Analyze the failure: ${symptom}`
                : `Refine hypothesis after step ${i - 1}; identify the smallest experiment that discriminates the leading causes.`;
            try {
              const text = unwrap(
                await deps.call(thinkTool, {
                  thought,
                  thoughtNumber: i,
                  totalThoughts: maxSteps,
                  nextThoughtNeeded: i < maxSteps,
                }),
              );
              thoughts.push(text.slice(0, 1200));
              record(steps, `think_${i}`, "ok");
            } catch (error) {
              record(steps, `think_${i}`, "failed", errorMessage(error));
              break;
            }
          }
        }

        const program = optionalString(args, "program");
        const filePath = optionalString(args, "filePath");
        const breakpoints = Array.isArray(args.breakpoints)
          ? args.breakpoints.filter((n): n is number => typeof n === "number")
          : [];
        const observations: JsonObject = {};

        const launchTool = deps.find("dap", ["launch", "attach", "start"]);
        const breakpointTool = deps.find("dap", [
          "set_breakpoint",
          "add_breakpoint",
          "setbreakpoint",
        ]);

        if (!program) {
          record(steps, "dap_launch", "skipped", "program is required to launch a debug session.");
        } else if (!launchTool) {
          record(steps, "dap_launch", "skipped", "DAP namespace unavailable.");
        } else {
          try {
            observations.launch = parseJson(
              unwrap(await deps.call(launchTool, { program })),
            );
            record(steps, "dap_launch", "ok");
          } catch (error) {
            record(steps, "dap_launch", "failed", errorMessage(error));
          }

          if (breakpointTool && filePath && breakpoints.length > 0) {
            try {
              observations.breakpoints = parseJson(
                unwrap(
                  await deps.call(breakpointTool, {
                    file: filePath,
                    filePath,
                    lines: breakpoints,
                    breakpoints,
                  }),
                ),
              );
              record(steps, "dap_breakpoints", "ok");
            } catch (error) {
              record(steps, "dap_breakpoints", "failed", errorMessage(error));
            }
          } else {
            record(
              steps,
              "dap_breakpoints",
              "skipped",
              "Need filePath, at least one breakpoint, and a DAP breakpoint tool.",
            );
          }

          const continueTool = deps.find("dap", ["continue", "resume", "run"]);
          if (continueTool) {
            try {
              observations.continued = parseJson(unwrap(await deps.call(continueTool, {})));
              record(steps, "dap_continue", "ok");
            } catch (error) {
              record(steps, "dap_continue", "failed", errorMessage(error));
            }
          }

          const stackTool = deps.find("dap", ["stack_trace", "get_stack_trace", "stacktrace"]);
          if (stackTool) {
            try {
              observations.stack = parseJson(unwrap(await deps.call(stackTool, {})));
              record(steps, "dap_stack", "ok");
            } catch (error) {
              record(steps, "dap_stack", "failed", errorMessage(error));
            }
          }

          const variablesTool = deps.find("dap", ["variables", "get_variables", "scopes"]);
          if (variablesTool) {
            try {
              observations.variables = parseJson(unwrap(await deps.call(variablesTool, {})));
              record(steps, "dap_variables", "ok");
            } catch (error) {
              record(steps, "dap_variables", "failed", errorMessage(error));
            }
          }
        }

        const memTool = deps.find("mem", ["remember"]);
        if (memTool) {
          try {
            await deps.call(memTool, {
              content: [
                `Debug session: ${symptom}`,
                `Thoughts: ${thoughts.join(" | ").slice(0, 2000)}`,
                `Observations: ${safeJson(observations, 1500)}`,
              ].join("\n"),
              hall: "findings",
              room: "debugging",
              importance: 6,
              tags: ["debug"],
            });
            record(steps, "mem_remember", "ok");
          } catch (error) {
            record(steps, "mem_remember", "failed", errorMessage(error));
          }
        } else {
          record(steps, "mem_remember", "skipped", "mem namespace unavailable.");
        }

        return textResult({
          ok: steps.every((step) => step.status !== "failed"),
          symptom,
          thoughts,
          observations,
          steps,
        });
      },
    },
  ];
}
