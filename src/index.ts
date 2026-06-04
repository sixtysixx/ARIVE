import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ContentRouter } from "./analyze/content_router.js";
import { SmartCrusher } from "./analyze/smart_crusher.js";
import { ASTCompressor } from "./analyze/ast_compressor.js";
import { CacheAligner } from "./analyze/cache_aligner.js";
import { CCRRegistry } from "./analyze/ccr_registry.js";
import { CodeMapScanner } from "./analyze/codemap.js";
import { SequentialEngine } from "./reason/sequential_engine.js";
import { WorkspaceManager } from "./integrate/workspace.js";
import { TDDRunner } from "./verify/tdd_runner.js";
import { Validator } from "./verify/validator.js";
import { LithicFormatter } from "./explain/lithic_formatter.js";
import * as fs from "fs";

// Setup server instance
const server = new Server(
  {
    name: "arive",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Registries and Engine State
const ccr = new CCRRegistry();
const engine = new SequentialEngine();

// Register List Tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "arive_compress",
        description: "Compresses strings based on code, JSON, logs or prose optimizations, return hash references for large sizes.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The content raw text block" },
            contentType: { type: "string", enum: ["json", "code", "logs", "prose", "auto"], default: "auto" },
            forceCcr: { type: "boolean", default: false }
          },
          required: ["content"]
        }
      },
      {
        name: "arive_decompress",
        description: "Resolves CCR reference hashes back to their raw uncompressed representation.",
        inputSchema: {
          type: "object",
          properties: {
            hash: { type: "string", description: "The CCR hash (e.g. ccr:sha256_hash)" }
          },
          required: ["hash"]
        }
      },
      {
        name: "arive_think",
        description: "Records a single thought block in the reasoning sequence, managing backtracking.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string" },
            thoughtNumber: { type: "integer" },
            totalThoughts: { type: "integer" },
            nextThoughtNeeded: { type: "boolean" },
            isRevision: { type: "boolean" },
            revisesThoughtNum: { type: "integer" },
            branchToThoughtNum: { type: "integer" }
          },
          required: ["thought", "thoughtNumber", "totalThoughts", "nextThoughtNeeded"]
        }
      },
      {
        name: "arive_integrate",
        description: "Controls the workspace lifecycle (Git worktrees) and spawns subprocesses.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            action: { type: "string", enum: ["create", "execute", "cleanup"] },
            branchName: { type: "string" },
            command: { type: "string" }
          },
          required: ["taskId", "action"]
        }
      },
      {
        name: "arive_verify",
        description: "Runs testing suites in the isolated workspace path and backpropagates failures.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            testCommand: { type: "string" }
          },
          required: ["taskId", "testCommand"]
        }
      },
      {
        name: "arive_explain",
        description: "Transforms conversational messages into telegraphic token-saving caveman styles.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
            brevity: { type: "string", enum: ["lite", "full", "ultra", "normal"], default: "full" }
          },
          required: ["message"]
        }
      },
      {
        name: "arive_codemap",
        description: "Scans folder structure tree, maps imports/exports, or runs git diff checks.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["tree", "dependencies", "diff"],
              description: "The codemap operation to perform"
            },
            dir: {
              type: "string",
              description: "The directory to scan for tree/dependencies"
            },
            excludes: {
              type: "array",
              items: { type: "string" },
              description: "List of directories to exclude"
            },
            maxDepth: {
              type: "integer",
              description: "Max depth to scan for directory tree"
            },
            targetBranch: {
              type: "string",
              description: "Target branch for git diff comparison"
            }
          },
          required: ["action"]
        }
      }
    ]
  };
});

// Tool routing execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "arive_compress": {
        const content = String(args?.content || "");
        const forceCcr = Boolean(args?.forceCcr);
        const userType = String(args?.contentType || "auto");

        const detectedType = userType === "auto" ? ContentRouter.classify(content) : userType;
        let compressed = content;

        if (detectedType === "json") {
          compressed = SmartCrusher.crush(content);
        } else if (detectedType === "code") {
          compressed = ASTCompressor.compress(content);
        } else if (detectedType === "prose") {
          compressed = CacheAligner.align(content);
        }

        // Always store in CCR if > 1000 characters or forced
        const threshold = 1000;
        const useCcr = forceCcr || content.length > threshold;
        let resultHash = "";

        if (useCcr) {
          resultHash = ccr.store(content);
          return {
            content: [{ type: "text", text: JSON.stringify({ compressed: resultHash, hash: resultHash, wasStoredInCcr: true }, null, 2) }]
          };
        }

        const rawHash = ccr.store(content);
        return {
          content: [{ type: "text", text: JSON.stringify({ compressed, hash: rawHash, wasStoredInCcr: false }, null, 2) }]
        };
      }

      case "arive_decompress": {
        const hash = String(args?.hash || "");
        const original = ccr.retrieve(hash);
        if (!original) {
          throw new Error(`CCR Key ${hash} not found in database registry.`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ content: original }) }]
        };
      }

      case "arive_think": {
        const thought = String(args?.thought || "");
        const tNum = Number(args?.thoughtNumber);
        const total = Number(args?.totalThoughts);
        const nextNeeded = Boolean(args?.nextThoughtNeeded);
        const isRev = args?.isRevision !== undefined ? Boolean(args.isRevision) : undefined;
        const revNum = args?.revisesThoughtNum !== undefined ? Number(args.revisesThoughtNum) : undefined;
        const branchNum = args?.branchToThoughtNum !== undefined ? Number(args.branchToThoughtNum) : undefined;

        if (args?.thoughtNumber === undefined || Number.isNaN(tNum)) {
          throw new Error("Invalid parameter: 'thoughtNumber' must be a valid number");
        }
        if (args?.totalThoughts === undefined || Number.isNaN(total)) {
          throw new Error("Invalid parameter: 'totalThoughts' must be a valid number");
        }
        if (revNum !== undefined && Number.isNaN(revNum)) {
          throw new Error("Invalid parameter: 'revisesThoughtNum' must be a valid number");
        }
        if (branchNum !== undefined && Number.isNaN(branchNum)) {
          throw new Error("Invalid parameter: 'branchToThoughtNum' must be a valid number");
        }

        const res = engine.addThought(thought, tNum, total, nextNeeded, isRev, revNum, branchNum);
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
        };
      }

      case "arive_integrate": {
        const taskId = String(args?.taskId || "");
        const action = String(args?.action || "");
        const branchName = args?.branchName ? String(args.branchName) : undefined;
        const command = args?.command ? String(args.command) : undefined;

        WorkspaceManager.validateTaskId(taskId);

        if (action === "create") {
          const resPath = WorkspaceManager.create(taskId, branchName);
          return {
            content: [{ type: "text", text: JSON.stringify({ taskId, status: "created", path: resPath }) }]
          };
        } else if (action === "execute") {
          const targetPath = `.arive-worktrees/${taskId}`;
          if (!fs.existsSync(targetPath)) {
            throw new Error(`Workspace path for ${taskId} does not exist. Call create first.`);
          }
          const execRes = TDDRunner.run(targetPath, command || "bun test");
          return {
            content: [{ type: "text", text: JSON.stringify({ taskId, status: "executed", ...execRes }) }]
          };
        } else if (action === "cleanup") {
          WorkspaceManager.cleanup(taskId);
          return {
            content: [{ type: "text", text: JSON.stringify({ taskId, status: "cleaned" }) }]
          };
        }
        throw new Error(`Unknown integrate action: ${action}`);
      }

      case "arive_verify": {
        const taskId = String(args?.taskId || "");
        const testCmd = String(args?.testCommand || "bun test");

        WorkspaceManager.validateTaskId(taskId);

        const targetPath = `.arive-worktrees/${taskId}`;
        if (!fs.existsSync(targetPath)) {
          throw new Error(`Workspace path for ${taskId} does not exist. Call integrate create first.`);
        }

        const res = TDDRunner.run(targetPath, testCmd);
        if (!res.success) {
          Validator.backpropagate(engine, res.failures);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
        };
      }

      case "arive_explain": {
        const message = String(args?.message || "");
        const brevity = (args?.brevity || "full") as "lite" | "full" | "ultra" | "normal";
        const formatted = LithicFormatter.format(message, brevity);
        const savings = LithicFormatter.getSavings(message, formatted);
        return {
          content: [{ type: "text", text: JSON.stringify({ formatted, savings }) }]
        };
      }

      case "arive_codemap": {
        const action = String(args?.action || "tree");
        const dir = String(args?.dir || ".");
        const excludes = Array.isArray(args?.excludes) ? args.excludes.map(String) : [];
        const targetBranch = String(args?.targetBranch || "master");

        let maxDepth = 10;
        if (args?.maxDepth !== undefined) {
          const depth = Number(args.maxDepth);
          if (Number.isNaN(depth) || depth < 0) {
            throw new Error("Invalid parameter: 'maxDepth' must be a non-negative number");
          }
          maxDepth = depth;
        }

        const scanner = new CodeMapScanner();

        if (action === "tree") {
          const res = scanner.scanTree(dir, excludes, maxDepth);
          return {
            content: [{ type: "text", text: res }]
          };
        } else if (action === "dependencies") {
          const res = scanner.scanDependencies(dir, excludes);
          return {
            content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
          };
        } else if (action === "diff") {
          const res = scanner.getGitDiff(targetBranch);
          return {
            content: [{ type: "text", text: res }]
          };
        }
        throw new Error(`Unknown codemap action: ${action}`);
      }

      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: error.message }) }]
    };
  }
});

// Start Std Listener
try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ARIVE MCP Server successfully listening on stdio.");
} catch (error: any) {
  console.error("Fatal error: Failed to connect to stdio transport:", error);
  process.exit(1);
}
