import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_workspace",
        description:
          "Manages isolated ARIVE task workspaces under .arive-tasks/<taskId>. " +
          "action='create' copies the project into an isolated directory (node_modules is symlinked) so automated edits never touch your working tree; " +
          "action='list' returns existing workspaces; " +
          "action='cleanup' deletes one. " +
          "arive_verify runs its test command inside the workspace created here, so create it first.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "create", "cleanup"],
              default: "list",
              description:
                "list: return all workspaces. create: build (resetting any existing one). cleanup: delete the workspace.",
            },
            taskId: {
              type: "string",
              description:
                "Required for create and cleanup. A single path segment resolved inside .arive-tasks.",
            },
          },
          required: ["action"],
        },
      };
