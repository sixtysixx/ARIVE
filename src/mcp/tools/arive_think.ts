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
          },
          required: [
            "thought",
            "thoughtNumber",
            "totalThoughts",
            "nextThoughtNeeded",
          ],
        },
      };
