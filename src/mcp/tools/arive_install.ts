import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_install",
        description:
          "Automatically registers the ARIVE MCP server in all detected AI clients and installs Git pre-commit hooks, ARIVE protocol lifecycle hooks, fade skills/rules, and plugins.",
        inputSchema: {
          type: "object",
          properties: {
            workspacePath: {
              type: "string",
              description:
                "Optional path to the project/workspace root directory to install rules, skills, plugins, and hooks in",
            },
            editor: {
              type: "string",
              description:
                "Optional name of the specific AI editor/agent to install configuration for (e.g. cursor, cline, roo, windsurf, opencode, kilocode, claude, claudecode, antigravity, omp)",
            },
            scope: {
              type: "string",
              description:
                "Optional installation scope: global, project, both (default: both)",
              enum: ["global", "project", "both"],
            },
          },
        },
      };
