# Design Specification: Unified ARIVE Framework (Analyze, Reason, Integrate, Verify, Explain)

**Status:** Approved  
**Author:** Antigravity (Advanced Agentic Coding Pair)  
**Date:** 2026-06-04  
**Path:** `docs/superpowers/specs/2026-06-04-arive-design.md`

---

## 1. Executive Summary & Architectural Goals
The **ARIVE** framework is a complete, production-ready TypeScript/Node.js Model Context Protocol (MCP) server that runs as a single Node.js process exposing standard MCP tools. It integrates the core concepts of four development patterns:
1. **Context Compression (headroom)**: Local, reversible context compression.
2. **Reflective Reasoning (sequentialthinking)**: Step-by-step backtracking reasoning.
3. **Workspace Isolation (superpowers)**: Isolated workspaces via Git worktrees, test runner execution (TDD), and subagents.
4. **Telegraphic Language (caveman)**: Grammatically compressed output styles for token efficiency.

The server operates locally using standard MCP over stdio.

---

## 2. Directory Structure & Layout
Files will be laid out directly under the root of the workspace directory:
```text
/
 package.json
 tsconfig.json
 src/
    index.ts                 # MCP Server entry point (registers & routes ARIVE tools)
    analyze/
       content_router.ts     # Classifies incoming content types (JSON, Code, Prose, Logs)
       smart_crusher.ts      # Flattens & strips JSON arrays and structural redundancy
       ast_compressor.ts     # Strips comments, whitespace, and formatting using TS compiler API
       cache_aligner.ts      # Normalizes headers & definitions for prompt prefix stabilization
       ccr_registry.ts       # Local Content-Compressed Retrieval store for lossless recovery
    reason/
       sequential_engine.ts  # Manages step-by-step thinking graphs, state changes, and backtracking
    integrate/
       workspace.ts          # Shell controller for Git worktrees & isolated branch creation
       subagent_runner.ts    # Safely launches task-scoped CLI/API subagents
    verify/
       tdd_runner.ts         # Executes automated test runners and returns structured failures
       validator.ts          # Structural validator matching output hashes back to CCR sources
    explain/
       lithic_formatter.ts   # Translates text into high-density, low-token caveman syntax
```

---

## 3. System Components & Implementation Specifications

### A - Analyze (Context Compression & Retrieval)
*   **Content Router (`content_router.ts`)**: Reads text and classifies it as `json`, `code`, `logs`, or `prose` using regex heuristics, extension parsing, and `JSON.parse` attempts.
*   **Smart Crusher (`smart_crusher.ts`)**: Traverses JSON nodes. It limits arrays to the first 2 indices, appending a summary tag (e.g. `"<truncated N items>"`). It identifies and preserves SRE/error fields (`error`, `message`, `stack`, `statusCode`) while dropping metadata.
*   **AST Compressor (`ast_compressor.ts`)**: Uses the TypeScript compiler API to parse source code files. It traverses the AST to print a comment-free, JSDoc-free, whitespace-minimized version of the code, retaining all functional logic.
*   **CCR Registry (`ccr_registry.ts`)**: A hash-based store mapping `sha256(content)` -> `content`. Extremely large texts are stored in CCR and referenced as `ccr:sha256_hash`. Decompression expands this back. State is flushed to `.arive/ccr_store.json`.
*   **Cache Aligner (`cache_aligner.ts`)**: Standardizes whitespace, removes empty lines, normalizes carriage returns to Unix LF (`\n`), and shapes headers to ensure maximum KV cache hit rates on providers like Anthropic or Gemini.

### R - Reason (Reflective Step-by-Step Logic)
*   **Sequential Engine (`sequential_engine.ts`)**:
    *   Tracks thoughts as:
        ```typescript
        interface Thought {
          thoughtNumber: number;
          totalThoughts: number;
          thought: string;
          nextThoughtNeeded: boolean;
          isRevision?: boolean;
          revisesThoughtNum?: number;
          branchToThoughtNum?: number;
          timestamp: string;
          status: 'active' | 'backtracked';
        }
        ```
    *   Provides backtracking: when a revision is triggered (`revisesThoughtNum`), all thoughts after the target index are updated to status `backtracked`. The next thought appends as a child of the revised thought, establishing a new branch path.
    *   Saves active state to `.arive/thinking_state.json`.

### I - Integrate (Git Worktrees & Subagent Mechanics)
*   **Workspace Manager (`workspace.ts`)**:
    *   Executes shell commands via `child_process` to run `git worktree add -b arive-task-<taskId> .arive-worktrees/<taskId>`.
    *   Validates that Git is initialized. If not, it runs `git init` and commits a dummy file so that worktree operations are permitted.
    *   Cleans up workspaces with `git worktree remove --force .arive-worktrees/<taskId>` and deletes the temporary branch.
*   **Subagent Runner (`subagent_runner.ts`)**:
    *   Executes user-specified build, compile, or custom CLI tasks inside the isolated worktree directory.
    *   Returns structured exit codes, stdout, and stderr.

### V - Verify (TDD Feedback loops)
*   **TDD Runner (`tdd_runner.ts`)**:
    *   Runs the specified `testCommand` (e.g. `bun test`) inside the isolated workspace directory.
    *   Parses outputs to find lines signaling test failure (e.g. `FAIL`, `Error:`, `Exception:`).
*   **Validator (`validator.ts`)**:
    *   Ensures that if tests fail, it automatically appends a failure state block to the `sequential_engine` reasoning graph.
    *   Validates that any decompressed CCR values match the original hash.

### E - Explain (Lithic Formatters)
*   **Lithic Formatter (`lithic_formatter.ts`)**:
    *   Converts text using grammatical reduction rules based on selected brevity levels:
        *   `lite`: Strips conversational filler ("just", "actually", "basically").
        *   `full`: Strips English articles ("the", "a", "an"), filters out auxiliary verbs ("is", "are", "was", "were", "have" as helpers), and uses short-form verbs.
        *   `ultra`: telegraphic code representation, leaving only key variables, statuses, and paths.
        *   `normal`: Direct bypass, returning raw content.

---

## 4. MCP Tools Definitions

| Tool Name | Parameters | Returns |
|---|---|---|
| `arive_compress` | `{ content: string, contentType?: string, forceCcr?: boolean }` | `{ compressed: string, hash: string, wasStoredInCcr: boolean }` |
| `arive_decompress` | `{ hash: string }` | `{ content: string }` |
| `arive_think` | `{ thought: string, thoughtNumber: number, totalThoughts: number, nextThoughtNeeded: boolean, isRevision?: boolean, revisesThoughtNum?: number, branchToThoughtNum?: number }` | `{ currentHistory: Thought[], activePlan: string }` |
| `arive_integrate` | `{ taskId: string, action: "create" \| "execute" \| "cleanup", branchName?: string, command?: string }` | `{ taskId: string, status: string, output: string, path?: string }` |
| `arive_verify` | `{ taskId: string, testCommand: string }` | `{ success: boolean, failures: string[], output: string }` |
| `arive_explain` | `{ message: string, brevity?: "lite" \| "full" \| "ultra" \| "normal" }` | `{ formatted: string, savings: string }` |

---

## 5. Development Mechanics & Coding Integrity
*   No placeholder files or `// TODO` comments.
*   Every function will be fully typed in TypeScript and fully implemented.
*   Builds will compile to ESNext target using standard Bun tooling.
*   Tests will be written for each component under `tests/` and run using `bun test`.
