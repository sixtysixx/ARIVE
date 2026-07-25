import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_verify",
        description:
          "Runs testing suites in the isolated workspace path and backpropagates failures.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            testCommand: { type: "string" },
          },
          required: ["taskId", "testCommand"],
        },
      };
