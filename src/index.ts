#!/usr/bin/env bun
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
import { CodeTreeScanner } from "./analyze/codetree.js";
import { SequentialEngine } from "./reason/sequential_engine.js";
import {
  MemoryBank,
  MemoryVerb,
  parseRememberIntent,
} from "./reason/memory_bank.js";
import { WorkspaceManager } from "./integrate/workspace.js";
import { HookManager } from "./integrate/hook_manager.js";
import { TDDRunner } from "./verify/tdd_runner.js";
import { Validator } from "./verify/validator.js";
import { FadeFormatter } from "./explain/fade_formatter.js";
import {
  createCompactHelpers,
  CompactObject,
  CompactText,
} from "./mcp/compact.js";
import * as fs from "fs";
import * as path from "path";
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
  },
);

// Registries and Engine State — lazy so stdio can connect immediately
interface EngineState {
  ccr: CCRRegistry | undefined;
  engine: SequentialEngine | undefined;
  memoryBank: MemoryBank | undefined;
  compactText: CompactText | undefined;
  compactObject: CompactObject | undefined;
}

const engineState: EngineState = {
  ccr: undefined,
  engine: undefined,
  memoryBank: undefined,
  compactText: undefined,
  compactObject: undefined,
};

function getCCR(): CCRRegistry {
  if (!engineState.ccr) engineState.ccr = new CCRRegistry();
  return engineState.ccr;
}

function getEngine(): SequentialEngine {
  if (!engineState.engine) engineState.engine = new SequentialEngine();
  return engineState.engine;
}

function getMemoryBank(): MemoryBank {
  if (!engineState.memoryBank) engineState.memoryBank = new MemoryBank();
  return engineState.memoryBank;
}

function getCompactHelpers() {
  if (!engineState.compactText || !engineState.compactObject) {
    const helpers = createCompactHelpers(getCCR());
    engineState.compactText = helpers.compactText;
    engineState.compactObject = helpers.compactObject;
  }
  return {
    compactText: engineState.compactText!,
    compactObject: engineState.compactObject!,
  };
}

// Register List Tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
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
      },
      {
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
      },
      {
        name: "arive_think",
        description:
          "Records a single thought block in the reasoning sequence, managing backtracking.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string" },
            thoughtNumber: { type: "integer" },
            totalThoughts: { type: "integer" },
            nextThoughtNeeded: { type: "boolean" },
            isRevision: { type: "boolean" },
            revisesThoughtNum: { type: "integer" },
            branchToThoughtNum: { type: "integer" },
            sessionId: {
              type: "string",
              description: "Optional session ID for multi-session reasoning",
              default: "default",
            },
          },
          required: [
            "thought",
            "thoughtNumber",
            "totalThoughts",
            "nextThoughtNeeded",
          ],
        },
      },
      {
        name: "arive_integrate",
        description:
          "Controls the workspace lifecycle (Git worktrees) and spawns subprocesses.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            action: { type: "string", enum: ["create", "execute", "cleanup"] },
            branchName: { type: "string" },
            command: { type: "string" },
          },
          required: ["taskId", "action"],
        },
      },
      {
        name: "arive_workspace_list",
        description: "Lists all active ARIVE worktree workspaces.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "arive_verify",
        description:
          "Runs testing suites in the isolated workspace path and backpropagates failures.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            testCommand: { type: "string" },
          },
          required: ["taskId", "testCommand"],
        },
      },
      {
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
      },
      {
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
            maxDepth: {
              type: "integer",
              description: "Max depth to scan for directory tree",
            },
            targetBranch: {
              type: "string",
              description: "Target branch for git diff comparison",
            },
          },
          required: ["action"],
        },
      },
      {
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
      },
      {
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
                "Optional name of the specific AI editor to install configuration for (e.g. cursor, cline, roo, windsurf, opencode, kilocode, claude, claudecode, antigravity, omp)",
            },
          },
        },
      },
    ],
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
        const threshold =
          args?.ccrThreshold !== undefined ? Number(args.ccrThreshold) : 1000;

        const preHook = HookManager.runHook("pre-analyze", "analyze", {
          content,
          contentType: userType,
          forceCcr,
          ccrThreshold: threshold,
        });
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-analyze: ${preHook.error}`);
        }

        const detectedType =
          userType === "auto" ? ContentRouter.classify(content) : userType;
        let compressed = content;

        if (detectedType === "json") {
          compressed = SmartCrusher.crush(content);
        } else if (detectedType === "code") {
          compressed = ASTCompressor.compress(content);
        } else if (detectedType === "prose") {
          compressed = CacheAligner.align(content);
        }

        // Always store in CCR if > threshold or forced
        const useCcr = forceCcr || content.length > threshold;
        let resultHash = "";
        let responseObj;

        if (useCcr) {
          resultHash = getCCR().store(content, detectedType);
          responseObj = {
            compressed: resultHash,
            hash: resultHash,
            wasStoredInCcr: true,
            type: detectedType,
          };
        } else {
          const rawHash = getCCR().store(content, detectedType);
          responseObj = {
            compressed,
            hash: rawHash,
            wasStoredInCcr: false,
            type: detectedType,
          };
        }

        const postHook = HookManager.runHook(
          "post-analyze",
          "analyze",
          { content, contentType: userType, forceCcr, ccrThreshold: threshold },
          responseObj,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-analyze: ${postHook.error}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseObj, null, 2),
            },
          ],
        };
      }

      case "arive_decompress": {
        const hash = String(args?.hash || "");
        const original = getCCR().retrieve(hash);
        if (!original) {
          throw new Error(`CCR Key ${hash} not found in database registry.`);
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ content: original }) },
          ],
        };
      }

      case "arive_think": {
        const thought = String(args?.thought || "");
        const tNum = Number(args?.thoughtNumber);
        const total = Number(args?.totalThoughts);
        const nextNeeded = Boolean(args?.nextThoughtNeeded);
        const isRev =
          args?.isRevision !== undefined ? Boolean(args.isRevision) : undefined;
        const revNum =
          args?.revisesThoughtNum !== undefined
            ? Number(args.revisesThoughtNum)
            : undefined;
        const branchNum =
          args?.branchToThoughtNum !== undefined
            ? Number(args.branchToThoughtNum)
            : undefined;
        const sessionId =
          args?.sessionId !== undefined ? String(args.sessionId) : "default";

        if (args?.thoughtNumber === undefined || Number.isNaN(tNum)) {
          throw new Error(
            "Invalid parameter: 'thoughtNumber' must be a valid number",
          );
        }
        if (args?.totalThoughts === undefined || Number.isNaN(total)) {
          throw new Error(
            "Invalid parameter: 'totalThoughts' must be a valid number",
          );
        }
        if (revNum !== undefined && Number.isNaN(revNum)) {
          throw new Error(
            "Invalid parameter: 'revisesThoughtNum' must be a valid number",
          );
        }
        if (branchNum !== undefined && Number.isNaN(branchNum)) {
          throw new Error(
            "Invalid parameter: 'branchToThoughtNum' must be a valid number",
          );
        }

        const hookContext = {
          thought,
          thoughtNumber: tNum,
          totalThoughts: total,
          nextThoughtNeeded: nextNeeded,
          isRevision: isRev,
          revisesThoughtNum: revNum,
          branchToThoughtNum: branchNum,
          sessionId,
        };

        const preHook = HookManager.runHook(
          "pre-reason",
          "reason",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-reason: ${preHook.error}`);
        }

        const res = getEngine().addThought(
          thought,
          tNum,
          total,
          nextNeeded,
          isRev,
          revNum,
          branchNum,
          sessionId,
        );

        const postHook = HookManager.runHook(
          "post-reason",
          "reason",
          hookContext,
          res,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-reason: ${postHook.error}`);
        }

        const responseText = getCompactHelpers().compactObject(
          res,
          "reason",
          {},
        ).value as unknown as Record<string, unknown>;

        return {
          content: [
            { type: "text", text: JSON.stringify(responseText, null, 2) },
          ],
        };
      }

      case "arive_integrate": {
        const taskId = String(args?.taskId || "");
        const action = String(args?.action || "");
        const branchName = args?.branchName
          ? String(args.branchName)
          : undefined;
        const command = args?.command ? String(args.command) : undefined;

        WorkspaceManager.validateTaskId(taskId);

        const hookContext = { taskId, action, branchName, command };
        const preHook = HookManager.runHook(
          "pre-integrate",
          "integrate",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-integrate: ${preHook.error}`);
        }

        let resultObj;
        if (action === "create") {
          const resPath = WorkspaceManager.create(taskId);
          resultObj = {
            taskId,
            status: "created",
            path: resPath,
          };
        } else if (action === "execute") {
          const targetPath = WorkspaceManager.getTaskPath(taskId);
          if (!fs.existsSync(targetPath)) {
            throw new Error(
              `Workspace path for ${taskId} does not exist. Call create first.`,
            );
          }
          const execRes = TDDRunner.run(targetPath, command || "bun test");
          resultObj = {
            taskId,
            status: "executed",
            ...execRes,
          };
        } else if (action === "cleanup") {
          WorkspaceManager.cleanup(taskId);
          resultObj = { taskId, status: "cleaned" };
        } else {
          throw new Error(`Unknown integrate action: ${action}`);
        }

        const postHook = HookManager.runHook(
          "post-integrate",
          "integrate",
          hookContext,
          resultObj,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-integrate: ${postHook.error}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultObj, null, 2),
            },
          ],
        };
      }

      case "arive_workspace_list": {
        const list = WorkspaceManager.list();
        return {
          content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        };
      }

      case "arive_verify": {
        const taskId = String(args?.taskId || "");
        const testCmd = String(args?.testCommand || "bun test");

        WorkspaceManager.validateTaskId(taskId);

        const hookContext = { taskId, testCommand: testCmd };
        const preHook = HookManager.runHook(
          "pre-verify",
          "verify",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-verify: ${preHook.error}`);
        }

        const targetPath = WorkspaceManager.getTaskPath(taskId);
        if (!fs.existsSync(targetPath)) {
          throw new Error(
            `Workspace path for ${taskId} does not exist. Call integrate create first.`,
          );
        }

        const res = TDDRunner.run(targetPath, testCmd);
        if (!res.success) {
          Validator.backpropagate(getEngine(), res.failures);
        }

        const postHook = HookManager.runHook(
          "post-verify",
          "verify",
          hookContext,
          res,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-verify: ${postHook.error}`);
        }

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      case "arive_explain": {
        const message = String(args?.message || "");
        const brevity = (args?.brevity || "full") as
          "lite" | "full" | "ultra" | "normal";

        const hookContext = { message, brevity };
        const preHook = HookManager.runHook(
          "pre-explain",
          "explain",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-explain: ${preHook.error}`);
        }

        const formatted = FadeFormatter.format(message, brevity);
        const savingsText = FadeFormatter.getSavings(message, formatted);
        const charSavings = message.length - formatted.length;
        const charPercentage =
          message.length > 0
            ? Math.round((charSavings / message.length) * 100)
            : 0;
        const instructions = FadeFormatter.getInstructions(brevity);

        const responseObj = {
          explanation: {
            formatted,
            brevity,
            savings: {
              summary: savingsText,
              characterSavings: charSavings,
              characterPercentage: `${charPercentage}%`,
            },
            instructions,
          },
        };

        const postHook = HookManager.runHook(
          "post-explain",
          "explain",
          hookContext,
          responseObj,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-explain: ${postHook.error}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseObj, null, 2),
            },
          ],
        };
      }

      case "arive_codetree": {
        const action = String(args?.action || "tree");
        const rawDir = String(args?.dir || ".");
        const excludes = Array.isArray(args?.excludes)
          ? args.excludes.map(String)
          : [];
        const targetBranch = String(args?.targetBranch || "master");

        // Anchor dir to workspace root — prevents directory traversal (e.g. dir: "../../../")
        const workspaceRoot = path.resolve(process.cwd());
        const resolvedDir = path.resolve(rawDir);
        if (
          resolvedDir !== workspaceRoot &&
          !resolvedDir.startsWith(workspaceRoot + path.sep)
        ) {
          throw new Error(
            `Security: dir "${rawDir}" resolves outside the workspace root.`,
          );
        }
        const dir = resolvedDir;

        let maxDepth = 10;
        if (args?.maxDepth !== undefined) {
          const depth = Number(args.maxDepth);
          if (Number.isNaN(depth) || depth < 0) {
            throw new Error(
              "Invalid parameter: 'maxDepth' must be a non-negative number",
            );
          }
          maxDepth = depth;
        }

        const hookContext = { action, dir, excludes, targetBranch, maxDepth };
        const preHook = HookManager.runHook(
          "pre-analyze",
          "analyze",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-analyze: ${preHook.error}`);
        }

        const scanner = new CodeTreeScanner();
        let resultText = "";

        if (action === "tree") {
          resultText = scanner.scanTree(dir, excludes, maxDepth);
        } else if (action === "dependencies") {
          resultText = JSON.stringify(
            scanner.scanDependencies(dir, excludes),
            null,
            2,
          );
        } else if (action === "diff") {
          resultText = scanner.getGitDiff(targetBranch);
        } else {
          throw new Error(`Unknown codetree action: ${action}`);
        }

        let responseText = resultText;
        let responseRef = "";
        if (resultText.length > 0) {
          responseRef = getCCR().store(resultText, "codetree");
          HookManager.runHook(
            "post-compact",
            "analyze",
            { action, dir },
            {
              ref: responseRef,
              type: "codetree",
              originalLength: resultText.length,
            },
          );
        }

        const postHook = HookManager.runHook(
          "post-analyze",
          "analyze",
          hookContext,
          { result: responseText, ref: responseRef },
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-analyze: ${postHook.error}`);
        }

        const responsePayload = responseRef
          ? { ref: responseRef, text: responseText }
          : { text: responseText };

        return {
          content: [{ type: "text", text: JSON.stringify(responsePayload) }],
        };
      }

      case "arive_memory_bank": {
        const action = (args?.action || "recall") as MemoryVerb;
        const wing = String(args?.wing || "user-memories");
        const room = String(args?.room || "conversational");
        const hall = String(args?.hall || "general");
        const drawer = args?.drawer !== undefined ? String(args.drawer) : "";
        const content = String(args?.content || "");
        const tags = Array.isArray(args?.tags) ? (args.tags as string[]) : [];
        const metadata =
          typeof args?.metadata === "object" && args.metadata !== null
            ? (args.metadata as Record<string, unknown>)
            : undefined;
        const drawerId = String(args?.drawerId || "");
        const query = String(args?.query || "");
        const limit =
          args?.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;

        const hookContext = {
          action,
          wing,
          room,
          hall,
          drawer,
          drawerId,
          query,
          limit,
          hasContent: Boolean(content),
        };
        const preHook = HookManager.runHook(
          "pre-memory",
          "memory",
          hookContext,
        );
        if (!preHook.success) {
          throw new Error(`[Hook Blocked] pre-memory: ${preHook.error}`);
        }

        let resultObj: unknown;

        switch (action) {
          case "remember": {
            // PRIMARY path: parse the user's natural-language phrase from `content`.
            // e.g. content = "remember to buy oat milk" → extracted content = "buy oat milk"
            if (!content.trim()) {
              throw new Error(
                "content is required for the 'remember' verb (pass the full user phrase).",
              );
            }
            const intent = parseRememberIntent(content);
            if (intent) {
              // Intent matched — use inferred hierarchy + importance metadata.
              const entry = getMemoryBank().write({
                wing: intent.wing,
                room: intent.room,
                hall: intent.hall,
                drawer: intent.drawer,
                content: intent.content,
                tags: intent.tags,
                metadata: {
                  importance: intent.importance,
                  source: "remember-intent",
                },
              });
              resultObj = {
                status: "remembered",
                drawerId: entry.drawerId,
                wing: entry.wing,
                room: entry.room,
                hall: entry.hall,
                tags: entry.tags,
                importance: intent.importance,
                extractedContent: intent.content,
                createdAt: entry.createdAt,
              };
            } else {
              // No trigger phrase matched — store the content verbatim under provided hierarchy.
              const entry = getMemoryBank().write({
                wing,
                room,
                hall,
                drawer,
                content,
                tags: tags.length ? tags : ["user-memory"],
                metadata,
              });
              resultObj = {
                status: "written",
                note: "No 'remember to/that' trigger detected; stored verbatim.",
                drawerId: entry.drawerId,
                wing: entry.wing,
                room: entry.room,
                hall: entry.hall,
                tags: entry.tags,
                createdAt: entry.createdAt,
              };
            }
            break;
          }
          case "drawer_write": {
            if (!content.trim()) {
              throw new Error("content is required for drawer_write");
            }
            const entry = getMemoryBank().write({
              wing,
              room,
              hall,
              drawer,
              content,
              tags,
              metadata,
            });
            resultObj = {
              status: "written",
              drawerId: entry.drawerId,
              wing: entry.wing,
              room: entry.room,
              hall: entry.hall,
              createdAt: entry.createdAt,
              tags: entry.tags,
            };
            break;
          }
          case "drawer_read": {
            if (!drawerId.trim())
              throw new Error("drawerId is required for drawer_read");
            resultObj = getMemoryBank().read(drawerId);
            break;
          }
          case "drawer_list": {
            resultObj = {
              wing,
              room,
              hall,
              entries: getMemoryBank().list(wing, room, hall, limit),
            };
            break;
          }
          case "search":
          case "recall": {
            if (!query.trim())
              throw new Error("query is required for search/recall");
            resultObj = {
              query,
              results: getMemoryBank().recall(query, limit),
            };
            break;
          }
          case "forget": {
            if (!drawerId.trim())
              throw new Error("drawerId is required for forget");
            resultObj = getMemoryBank().forget(drawerId);
            break;
          }
          case "stats": {
            resultObj = getMemoryBank().stats();
            break;
          }
          case "wing_create":
          case "room_create":
          case "hall_create": {
            resultObj = {
              status: "ok",
              note: "Hierarchy nodes are created lazily on first write. Use drawer_write with the desired wing/room/hall to materialise them.",
            };
            break;
          }
          default:
            throw new Error(`Unknown memory action: ${action}`);
        }

        const postHook = HookManager.runHook(
          "post-memory",
          "memory",
          hookContext,
          resultObj,
        );
        if (!postHook.success) {
          throw new Error(`[Hook Failed] post-memory: ${postHook.error}`);
        }

        const responseText = getCompactHelpers().compactObject(
          resultObj,
          "memory",
          hookContext,
        ).value as unknown as Record<string, unknown>;

        return {
          content: [
            { type: "text", text: JSON.stringify(responseText, null, 2) },
          ],
        };
      }

      case "arive_install": {
        const workspacePath = args?.workspacePath
          ? String(args.workspacePath)
          : undefined;
        const editor = args?.editor ? String(args.editor) : undefined;
        const { installAllAsync } = await import("./cli/installer.js");
        // Start async installation, return immediately
        installAllAsync(workspacePath, editor).catch((err) => {
          console.error("[arive_install] async install failed:", err);
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "started",
                message: `ARIVE installation started in background${editor ? ` for ${editor}` : ""}. Check logs for progress.`,
              }),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    };
  }
});

// Check if running in install CLI mode
if (process.argv.includes("install")) {
  const { runInstallerCli } = await import("./cli/installer.js");
  runInstallerCli();
  process.exit(0);
}

// Check if running in prompt/generate-prompt mode
if (process.argv.includes("prompt") || process.argv.includes("generate-prompt")) {
  const { outputAdvancedPrompt } = await import("./cli/prompt_generator.js");
  outputAdvancedPrompt();
  process.exit(0);
}

// Start Std Listener
console.error("[arive] start: initializing MCP stdio transport");
try {
  const before = Date.now();
  const transport = new StdioServerTransport();
  console.error(
    `[arive] transport created after ${Date.now() - before}ms, connecting...`,
  );
  await server.connect(transport);
  console.error(`[arive] ready after ${Date.now() - before}ms`);
} catch (error: unknown) {
  console.error("[arive] fatal: failed to connect to stdio transport:", error);
  process.exit(1);
}
