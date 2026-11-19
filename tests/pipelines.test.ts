import { describe, expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Namespace } from "../src/core/config.js";
import type { JsonObject, LocalTool } from "../src/core/results.js";
import {
  createPipelineTools,
  type PipelineDeps,
} from "../src/pipelines/index.js";

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

interface FakeOptions {
  mem?: boolean;
  think?: boolean;
  dap?: boolean;
}

function makeDeps(options: FakeOptions = {}): PipelineDeps {
  const { mem = true, think = false, dap = false } = options;

  return {
    refresh: async () => {},
    find: (namespace: Namespace, candidates: string[]) => {
      const match = (available: boolean, mapping: Record<string, string>) => {
        if (!available) return undefined;
        for (const candidate of candidates) {
          if (mapping[candidate]) return mapping[candidate];
        }
        return undefined;
      };
      if (namespace === "mem") return match(mem, { remember: "mem_remember" });
      if (namespace === "think") {
        return match(think, { sequentialthinking: "think_sequentialthinking" });
      }
      if (namespace === "dap") {
        return match(dap, {
          launch: "dap_launch",
          set_breakpoint: "dap_set_breakpoint",
        });
      }
      return undefined;
    },
    call: async (name: string, args: JsonObject) => {
      switch (name) {
        case "mem_remember":
          return text({ status: "remembered" });
        case "think_sequentialthinking":
          return text({ thoughtNumber: args.thoughtNumber });
        case "dap_launch":
          return text({ launched: true });
        case "dap_set_breakpoint":
          return text({ breakpoints: 1 });
        default:
          return text({ ok: true });
      }
    },
  };
}

function parse(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

const debug = (deps: PipelineDeps): LocalTool =>
  createPipelineTools(deps).find(
    (tool) => tool.name === "arive_reasoned_debug",
  )!;

describe("reasoned debug pipeline", () => {
  test("degrades to skipped steps without think/dap", async () => {
    const result = parse(
      await debug(makeDeps()).handler({ symptom: "segfault on startup" }),
    );
    const steps = result.steps as Array<{ step: string; status: string }>;
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s.status]));
    expect(byStep.sequential_thinking).toBe("skipped");
    expect(byStep.dap_launch).toBe("skipped");
    // Nothing was reasoned and nothing observed, so there is nothing to store.
    expect(byStep.mem_remember).toBe("skipped");
    expect(result.evidence).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.thoughts).toEqual([]);
  });

  test("reports ok when reasoning produced evidence", async () => {
    const result = parse(
      await debug(makeDeps({ think: true })).handler({
        symptom: "null deref",
        maxSteps: 2,
      }),
    );
    const steps = result.steps as Array<{ step: string; status: string }>;
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s.status]));
    expect(result.evidence).toBe(true);
    expect(byStep.mem_remember).toBe("ok");
    expect(result.ok).toBe(true);
  });

  test("records thoughts when sequential thinking is available", async () => {
    const result = parse(
      await debug(makeDeps({ think: true })).handler({
        symptom: "null deref",
        maxSteps: 2,
      }),
    );
    expect(result.thoughts as string[]).toHaveLength(2);
    const steps = result.steps as Array<{ step: string; status: string }>;
    expect(steps.find((s) => s.step === "think_1")?.status).toBe("ok");
    expect(steps.find((s) => s.step === "think_2")?.status).toBe("ok");
  });

  test("launches a debug session and sets breakpoints when DAP is present", async () => {
    const result = parse(
      await debug(makeDeps({ dap: true })).handler({
        symptom: "wrong result",
        program: "./app",
        filePath: "app.ts",
        breakpoints: [12],
      }),
    );
    const steps = result.steps as Array<{ step: string; status: string }>;
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s.status]));
    expect(byStep.dap_launch).toBe("ok");
    expect(byStep.dap_breakpoints).toBe("ok");
    const observations = result.observations as Record<string, unknown>;
    expect(observations.launch).toEqual({ launched: true });
    expect(observations.breakpoints).toEqual({ breakpoints: 1 });
  });

  test("marks follow-up steps skipped when the launch fails", async () => {
    const deps = makeDeps({ dap: true });
    const failing: PipelineDeps = {
      ...deps,
      call: async (name, args) => {
        if (name === "dap_launch") throw new Error("debugger refused to start");
        return deps.call(name, args);
      },
    };
    const result = parse(
      await debug(failing).handler({
        symptom: "crash on boot",
        program: "./app",
        filePath: "app.ts",
        breakpoints: [3],
      }),
    );
    const steps = result.steps as Array<{
      step: string;
      status: string;
      detail?: string;
    }>;
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s.status]));
    expect(byStep.dap_launch).toBe("failed");
    for (const step of [
      "dap_breakpoints",
      "dap_continue",
      "dap_stack",
      "dap_variables",
    ]) {
      expect(byStep[step]).toBe("skipped");
    }
    expect(result.ok).toBe(false);
  });

  test("is not ok when no step succeeded", async () => {
    const result = parse(
      await debug(makeDeps({ mem: false, think: false, dap: false })).handler({
        symptom: "nothing available",
      }),
    );
    const steps = result.steps as Array<{ step: string; status: string }>;
    expect(steps.every((s) => s.status === "skipped")).toBe(true);
    expect(result.ok).toBe(false);
  });

  test("skips the debugger when no program is supplied", async () => {
    const result = parse(
      await debug(makeDeps({ dap: true })).handler({
        symptom: "silent failure",
      }),
    );
    const steps = result.steps as Array<{
      step: string;
      status: string;
      detail?: string;
    }>;
    const launch = steps.find((s) => s.step === "dap_launch");
    expect(launch?.status).toBe("skipped");
    expect(launch?.detail).toContain("program");
  });
});
