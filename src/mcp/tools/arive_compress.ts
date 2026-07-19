import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_compress",
        description:
          "Compresses strings based on code, JSON, logs or prose optimizations, return hash references for large sizes.",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The content raw text block",
            },
            contentType: {
              type: "string",
              enum: ["json", "code", "logs", "prose", "auto"],
              default: "auto",
            },
            forceCcr: { type: "boolean", default: false },
            ccrThreshold: {
              type: "integer",
              description: "Character length threshold for CCR storage",
              default: 1000,
            },
          },
          required: ["content"],
        },
      };
