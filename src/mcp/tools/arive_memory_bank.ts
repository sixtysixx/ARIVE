import { ToolDef } from "./types.js";

export const toolDef: ToolDef = {
        name: "arive_memory_bank",
        description:
          "High-quality persistent memory bank inspired by ThoughtArchive. " +
          "ACTIVATE IMMEDIATELY when the user says 'remember to …', 'remember that …', 'don't forget …', " +
          "'keep in mind that …', 'make a note that …', or 'note: …'. " +
          "Use action='remember' to auto-parse the user's natural-language phrase and store it with auto-detected category, tags, and importance score. " +
          "Stores entries in a spatial hierarchy: wings > rooms > halls > drawers. " +
          "Use action='recall'/'search' to retrieve memories. Use action='stats' for a summary.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "remember",
                "drawer_write",
                "drawer_read",
                "drawer_list",
                "wing_create",
                "room_create",
                "hall_create",
                "search",
                "forget",
                "recall",
                "stats",
              ],
              description:
                "remember: PRIMARY verb — pass the user's full phrase (e.g. 'remember to buy milk') as content; auto-parses intent, tags, and importance. " +
                "drawer_write: directly store a memory with explicit wing/room/hall. " +
                "drawer_read: retrieve by drawerId. " +
                "drawer_list: list entries in a wing/room/hall. " +
                "search/recall: full-text LIKE search across all fields. " +
                "forget: delete by drawerId. " +
                "stats: return totals (drawers, wings, rooms, halls). " +
                "wing_create/room_create/hall_create: create hierarchy nodes (no-op, created lazily on write).",
            },
            wing: {
              type: "string",
              description:
                "Top-level category (wing). E.g. a project name, person name, or domain.",
            },
            room: {
              type: "string",
              description: "Sub-topic within the wing.",
            },
            hall: {
              type: "string",
              description:
                "Corridor organising memories by type: facts, preferences, decisions, reminders, discoveries, rules, general.",
            },
            drawer: {
              type: "string",
              description:
                "Optional label for the drawer (auto-derived from content if omitted).",
            },
            content: {
              type: "string",
              description:
                "For action='remember': the full user phrase (e.g. 'remember to fix the login bug'). " +
                "For drawer_write: the verbatim text to store.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags for categorization.",
            },
            metadata: {
              type: "object",
              additionalProperties: true,
              description: "Optional structured metadata.",
            },
            drawerId: {
              type: "string",
              description: "Required for drawer_read and forget.",
            },
            query: {
              type: "string",
              description: "Search query for search/recall verbs.",
            },
            limit: {
              type: "integer",
              description: "Max results for list/search. Default 50.",
              default: 50,
            },
          },
          required: ["action"],
        },
      };
