import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_decompress",
        description:
          "Resolves CCR reference hashes back to their raw uncompressed representation.",
        inputSchema: {
          type: "object",
          properties: {
            hash: {
              type: "string",
              description: "The CCR hash (e.g. ccr:sha256_hash)",
            },
          },
          required: ["hash"],
        },
      };
