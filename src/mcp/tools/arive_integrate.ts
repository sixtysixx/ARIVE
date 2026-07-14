import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_integrate",
        description:
          "Controls the workspace lifecycle (Git worktrees) and spawns subprocesses.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            action: { type: "string", enum: ["create", "execute", "cleanup"] },
            branchName: { type: "string" },
            command: { type: "string" },
          },
          required: ["taskId", "action"],
        },
      };
