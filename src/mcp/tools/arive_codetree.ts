import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_codetree",
        description:
          "Scans folder structure tree, maps imports/exports, or runs git diff checks.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["tree", "dependencies", "diff"],
              description: "The codetree operation to perform",
            },
            dir: {
              type: "string",
              description: "The directory to scan for tree/dependencies",
            },
            excludes: {
              type: "array",
              items: { type: "string" },
              description: "List of directories to exclude",
            },
            targetBranch: {
              type: "string",
              description: "Target branch for git diff comparison",
            },
          },
          required: ["action"],
        },
      };
