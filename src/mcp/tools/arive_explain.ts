import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_explain",
        description:
          "Transforms conversational messages into telegraphic token-saving fade styles, or returns fade instruction rules.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description:
                "The natural language message, or prompt to get fade instructions for",
            },
            brevity: {
              type: "string",
              enum: ["lite", "full", "ultra", "normal"],
              default: "full",
              description: "The fade level of brevity/laziness",
            },
          },
          required: ["message"],
        },
      };
