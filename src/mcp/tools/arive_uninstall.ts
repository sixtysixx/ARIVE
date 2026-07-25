import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_uninstall",
        description:
          "Removes the ARIVE MCP server registration, Fade rules/skills/plugins, lifecycle hooks, and .gitignore entries from all detected AI clients. The inverse of arive_install.",
        inputSchema: {
          type: "object",
          properties: {
            workspacePath: {
              type: "string",
              description:
                "Optional path to the project/workspace root directory to remove rules, skills, plugins, and hooks from",
            },
            editor: {
              type: "string",
              description:
                "Optional name of the specific AI editor/agent to remove configuration for (e.g. cursor, cline, roo, windsurf, opencode, kilocode, claude, claudecode, antigravity, omp)",
            },
            scope: {
              type: "string",
              description:
                "Optional uninstall scope: global, project, both (default: both)",
              enum: ["global", "project", "both"],
            },
          },
        },
      };
