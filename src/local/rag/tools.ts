import {
  errorResult,
  optionalNumber,
  optionalString,
  requireString,
  textResult,
  type LocalTool,
} from "../../core/results.js";
import { errorMessage } from "../../core/log.js";
import type { RagStore } from "./store.js";

export function createRagTools(store: RagStore): LocalTool[] {
  return [
    {
      name: "rag_index",
      description:
        "[RAG] Build or refresh the local retrieval index over a file tree (incremental by mtime+hash). Chunks are line-ranged and searchable immediately; embeddings are added when rag.embeddings.provider is configured.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File or directory to index. Defaults to cwd.",
          },
          glob: {
            type: "string",
            description: "Optional glob filter, e.g. '*.ts'.",
          },
          force: {
            type: "boolean",
            description: "Reindex unchanged files and re-embed the corpus.",
            default: false,
          },
          embed: {
            type: "boolean",
            description:
              "Compute embeddings for new chunks when a provider is configured.",
            default: true,
          },
          maxFiles: { type: "integer", minimum: 1 },
        },
      },
      handler: async (args) => {
        try {
          const glob = optionalString(args, "glob");
          const maxFiles = optionalNumber(args, "maxFiles");
          return textResult(
            await store.index({
              path: optionalString(args, "path"),
              ...(glob === undefined ? {} : { glob }),
              force: args.force === true,
              embed: args.embed !== false,
              ...(maxFiles === undefined ? {} : { maxFiles }),
            }),
          );
        } catch (error) {
          return errorResult(errorMessage(error), { tool: "rag_index" });
        }
      },
    },
    {
      name: "rag_query",
      description:
        "[RAG] Hybrid retrieval: BM25 over code-aware identifiers fused with cosine similarity when embeddings exist. Returns ranked chunks with path:line citations.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          topK: { type: "integer", minimum: 1, default: 8 },
          path: {
            type: "string",
            description: "Restrict results to this file or directory.",
          },
          maxChars: {
            type: "integer",
            minimum: 200,
            default: 8000,
            description: "Total characters of chunk text to return.",
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        try {
          const query = requireString(args, "query", "rag_query");
          const topK = optionalNumber(args, "topK");
          const maxChars = optionalNumber(args, "maxChars");
          return textResult(
            await store.query({
              query,
              ...(topK === undefined ? {} : { topK }),
              path: optionalString(args, "path"),
              ...(maxChars === undefined ? {} : { maxChars }),
            }),
          );
        } catch (error) {
          return errorResult(errorMessage(error), { tool: "rag_query" });
        }
      },
    },
    {
      name: "rag_stats",
      description:
        "[RAG] Report indexed file/chunk counts, embedding coverage, model, and database path.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        try {
          return textResult(store.stats());
        } catch (error) {
          return errorResult(errorMessage(error), { tool: "rag_stats" });
        }
      },
    },
    {
      name: "rag_forget",
      description: "[RAG] Drop a file or directory subtree from the retrieval index.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to forget." },
        },
        required: ["path"],
      },
      handler: (args) => {
        try {
          const target = requireString(args, "path", "rag_forget");
          return textResult(store.forget(target));
        } catch (error) {
          return errorResult(errorMessage(error), { tool: "rag_forget" });
        }
      },
    },
  ];
}
