import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_think",
        description:
          "Records a single thought block in the reasoning sequence, managing backtracking.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string" },
            thoughtNumber: { type: "integer" },
            totalThoughts: { type: "integer" },
            nextThoughtNeeded: { type: "boolean" },
            isRevision: { type: "boolean" },
            revisesThoughtNum: { type: "integer" },
            branchToThoughtNum: { type: "integer" },
            sessionId: {
              type: "string",
              description: "Optional session ID for multi-session reasoning",
              default: "default",
            },
            definedDone: {
              type: "string",
              description: "ARIVE Protocol: Named verification check that defines completion",
            },
            askShape: {
              type: "string",
              enum: ["trivial", "question", "task", "plan-first"],
              description: "ARIVE Protocol: Category of incoming ask",
            },
            claims: {
              type: "array",
              items: { type: "string" },
              description: "ARIVE Judge: List of claims to adversarially verify",
            },
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  check: { type: "string" },
                  status: { type: "string", enum: ["passed", "failed", "unobserved"] },
                  details: { type: "string" },
                },
                required: ["check", "status"],
              },
              description: "ARIVE Judge: Observed test results matching claims",
            },
          },
          required: [
            "thought",
            "thoughtNumber",
            "totalThoughts",
            "nextThoughtNeeded",
          ],
        },
      };
