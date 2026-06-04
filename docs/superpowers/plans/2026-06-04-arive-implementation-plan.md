# ARIVE Unified Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, production-ready, and fully realized TypeScript/Node.js Model Context Protocol (MCP) server named **ARIVE** that integrates context compression, sequential thinking, git-worktree workspace isolation, test verification loops, and telegraphic language formatting.

**Architecture:** The server will be implemented as a modular Node.js/TypeScript application exposing a stdio-based MCP interface using the official `@modelcontextprotocol/sdk`. It will read/write configurations and state to local `.arive/` files and leverage `git` sub-processes to manage isolated workspaces and test verification loops, utilizing TypeScript's Compiler API to compress source code ASTs.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`

---

## Task Map & File Layout

*   `package.json` - Bun package manager definitions & script entrypoints
*   `tsconfig.json` - TypeScript compilation configurations
*   `src/index.ts` - MCP Server Entrypoint (routes all tools, starts stdio)
*   `src/analyze/content_router.ts` - Routes input content based on detected types
*   `src/analyze/smart_crusher.ts` - Collapses repetitive JSON data and extracts errors
*   `src/analyze/ast_compressor.ts` - Strips comments/formatting from TS/JS code via TypeScript AST
*   `src/analyze/cache_aligner.ts` - Normalizes headers/prefixes for KV cache stabilization
*   `src/analyze/ccr_registry.ts` - Hash-based Content-Compressed Retrieval store
*   `src/reason/sequential_engine.ts` - Manages the reflective thinking graph and backtracking
*   `src/integrate/workspace.ts` - Orchestrates Git worktrees in `.arive-worktrees/`
*   `src/integrate/subagent_runner.ts` - Spawns and tracks CLI/API subprocesses
*   `src/verify/tdd_runner.ts` - Executes tests and returns failures
*   `src/verify/validator.ts` - Integrates failures into engine & verifies CCR hashes
*   `src/explain/lithic_formatter.ts` - Translates output to telegraphic low-token grammar

---

## Detailed Tasks

### Task 1: Project Initialization & Configuration
**Files:**
*   Create: `package.json`
*   Create: `tsconfig.json`
*   Test: `tests/init.test.ts`

- [ ] **Step 1: Write initialization configurations**
    Create `package.json` and `tsconfig.json`.
    
    `package.json`:
    ```json
    {
      "name": "arive-mcp",
      "version": "1.0.0",
      "type": "module",
      "main": "src/index.ts",
      "scripts": {
        "start": "bun run src/index.ts",
        "test": "bun test"
      },
      "dependencies": {
        "@modelcontextprotocol/sdk": "^1.0.1",
        "typescript": "^5.4.5"
      },
      "devDependencies": {
        "@types/node": "^20.12.12"
      }
    }
    ```

    `tsconfig.json`:
    ```json
    {
      "compilerOptions": {
        "target": "ESNext",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "outDir": "./dist",
        "declaration": true
      },
      "include": ["src/**/*"]
    }
    ```

- [ ] **Step 2: Install dependencies**
    Run: `bun install`
    Expected: Successful install of `@modelcontextprotocol/sdk` and `typescript`.

- [ ] **Step 3: Write initialization check test**
    Create `tests/init.test.ts`:
    ```typescript
    import { expect, test } from "bun:test";
    import * as fs from "fs";

    test("Project configurations exist", () => {
      expect(fs.existsSync("package.json")).toBe(true);
      expect(fs.existsSync("tsconfig.json")).toBe(true);
    });
    ```

- [ ] **Step 4: Run initialization test**
    Run: `bun test tests/init.test.ts`
    Expected: PASS

- [ ] **Step 5: Commit task 1**
    Run:
    ```bash
    git add package.json tsconfig.json tests/init.test.ts
    git commit -m "chore: initialize project configuration and dependencies"
    ```

---

### Task 2: Implement CCR Registry & Storage
**Files:**
*   Create: `src/analyze/ccr_registry.ts`
*   Test: `tests/ccr_registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**
    Create `tests/ccr_registry.test.ts`:
    ```typescript
    import { expect, test, describe, beforeAll, afterAll } from "bun:test";
    import { CCRRegistry } from "../src/analyze/ccr_registry.js";
    import * as fs from "fs";

    describe("CCR Registry Tests", () => {
      const dbPath = ".arive/test_ccr_store.json";
      
      beforeAll(() => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      });

      afterAll(() => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      });

      test("Store and retrieve contents", () => {
        const registry = new CCRRegistry(dbPath);
        const content = "Hello World Raw Content";
        const hash = registry.store(content);
        expect(hash).toBe("ccr:dffd6021bb2bd5b0af676df0d80d8e9f96c45b6db13187c340f1a9202db955a4");
        
        const retrieved = registry.retrieve(hash);
        expect(retrieved).toBe(content);
      });

      test("Returns null/undefined for missing hashes", () => {
        const registry = new CCRRegistry(dbPath);
        expect(registry.retrieve("ccr:missing")).toBeUndefined();
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/ccr_registry.test.ts`
    Expected: FAIL (Cannot find module '../src/analyze/ccr_registry.js')

- [ ] **Step 3: Write minimal implementation for CCRRegistry**
    Create `src/analyze/ccr_registry.ts`:
    ```typescript
    import * as fs from "fs";
    import * as path from "path";
    import { createHash } from "crypto";

    export class CCRRegistry {
      private dbPath: string;
      private storeMap: Record<string, string> = {};

      constructor(dbPath = ".arive/ccr_store.json") {
        this.dbPath = dbPath;
        this.load();
      }

      private load() {
        try {
          if (fs.existsSync(this.dbPath)) {
            const fileContent = fs.readFileSync(this.dbPath, "utf-8");
            this.storeMap = JSON.parse(fileContent);
          }
        } catch (e) {
          this.storeMap = {};
        }
      }

      private save() {
        try {
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(this.dbPath, JSON.stringify(this.storeMap, null, 2), "utf-8");
        } catch (e) {
          // Silent save failure
        }
      }

      public store(content: string): string {
        const sha = createHash("sha256").update(content).digest("hex");
        const key = `ccr:${sha}`;
        this.storeMap[key] = content;
        this.save();
        return key;
      }

      public retrieve(hash: string): string | undefined {
        return this.storeMap[hash];
      }
    }
    ```

- [ ] **Step 4: Run test to verify it passes**
    Run: `bun test tests/ccr_registry.test.ts`
    Expected: PASS

- [ ] **Step 5: Commit task 2**
    Run:
    ```bash
    git add src/analyze/ccr_registry.ts tests/ccr_registry.test.ts
    git commit -m "feat: implement CCR hash registry and store"
    ```

---

### Task 3: Content Routing & Processing Modules
**Files:**
*   Create: `src/analyze/content_router.ts`
*   Create: `src/analyze/smart_crusher.ts`
*   Create: `src/analyze/ast_compressor.ts`
*   Create: `src/analyze/cache_aligner.ts`
*   Test: `tests/analyze_pipeline.test.ts`

- [ ] **Step 1: Write failing tests for analyze pipeline**
    Create `tests/analyze_pipeline.test.ts`:
    ```typescript
    import { expect, test, describe } from "bun:test";
    import { ContentRouter } from "../src/analyze/content_router.js";
    import { SmartCrusher } from "../src/analyze/smart_crusher.js";
    import { ASTCompressor } from "../src/analyze/ast_compressor.js";
    import { CacheAligner } from "../src/analyze/cache_aligner.js";

    describe("Analyze Pipeline Tests", () => {
      test("Content Router classification", () => {
        expect(ContentRouter.classify("{ \"a\": 1 }")).toBe("json");
        expect(ContentRouter.classify("function test() { console.log('hi'); }")).toBe("code");
        expect(ContentRouter.classify("This is just standard prose writing.")).toBe("prose");
      });

      test("Smart Crusher JSON array flattening", () => {
        const rawJson = JSON.stringify({
          users: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
            { id: 3, name: "Charlie" },
            { id: 4, name: "Dave" }
          ],
          errors: { message: "Internal Failure", code: 500 }
        });
        const crushed = SmartCrusher.crush(rawJson);
        const parsed = JSON.parse(crushed);
        expect(parsed.users.length).toBe(3); // 2 elements + 1 descriptor string
        expect(parsed.users[2]).toContain("truncated 2 items");
        expect(parsed.errors.message).toBe("Internal Failure");
      });

      test("AST Compressor comment and JSDoc stripping", () => {
        const rawCode = `
          /**
           * This is JSDoc
           */
          function run(x: number) {
            // Single-line comment
            const y = x * 2; /* Inline comment */
            return y;
          }
        `;
        const compressed = ASTCompressor.compress(rawCode);
        expect(compressed).not.toContain("JSDoc");
        expect(compressed).not.toContain("Single-line comment");
        expect(compressed).not.toContain("Inline comment");
        expect(compressed.replace(/\s/g, "")).toContain("functionrun(x:number){consty=x*2;returny;}");
      });

      test("Cache Aligner normalizes content whitespace", () => {
        const prompt = "  Line 1   \r\n\r\n   Line 2 \n ";
        expect(CacheAligner.align(prompt)).toBe("Line 1\nLine 2");
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/analyze_pipeline.test.ts`
    Expected: FAIL (Cannot find module '../src/analyze/content_router.js')

- [ ] **Step 3: Implement ContentRouter**
    Create `src/analyze/content_router.ts`:
    ```typescript
    export class ContentRouter {
      public static classify(content: string): "json" | "code" | "logs" | "prose" {
        const trimmed = content.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            JSON.parse(trimmed);
            return "json";
          } catch (e) {}
        }
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          try {
            JSON.parse(trimmed);
            return "json";
          } catch (e) {}
        }

        // Simple regex heuristics for TS/JS/Python/Go code
        const codeKeywords = /\b(function|const|let|import|export|class|def|package|func|return)\b/;
        const curlyBlocks = /\{[\s\S]*\}/;
        if (codeKeywords.test(trimmed) && curlyBlocks.test(trimmed)) {
          return "code";
        }

        const logKeywords = /\b(ERROR|WARN|INFO|DEBUG|TRACE|exception|stacktrace|stderr|stdout)\b/i;
        if (logKeywords.test(trimmed) && trimmed.split("\n").length > 3) {
          return "logs";
        }

        return "prose";
      }
    }
    ```

- [ ] **Step 4: Implement SmartCrusher**
    Create `src/analyze/smart_crusher.ts`:
    ```typescript
    export class SmartCrusher {
      public static crush(content: string): string {
        try {
          const parsed = JSON.parse(content);
          const crushedObj = this.traverseAndCrush(parsed);
          return JSON.stringify(crushedObj);
        } catch (e) {
          return content;
        }
      }

      private static traverseAndCrush(val: any): any {
        if (Array.isArray(val)) {
          if (val.length <= 2) {
            return val.map(item => this.traverseAndCrush(item));
          }
          const slice = val.slice(0, 2).map(item => this.traverseAndCrush(item));
          return [...slice, `<truncated ${val.length - 2} items>`];
        }
        if (val !== null && typeof val === "object") {
          const newObj: Record<string, any> = {};
          for (const key of Object.keys(val)) {
            newObj[key] = this.traverseAndCrush(val[key]);
          }
          return newObj;
        }
        return val;
      }
    }
    ```

- [ ] **Step 5: Implement ASTCompressor**
    Create `src/analyze/ast_compressor.ts`:
    ```typescript
    import ts from "typescript";

    export class ASTCompressor {
      public static compress(code: string): string {
        try {
          const sourceFile = ts.createSourceFile(
            "temp.ts",
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          );

          return this.printNodeMinified(sourceFile, sourceFile).trim();
        } catch (e) {
          return code;
        }
      }

      private static printNodeMinified(node: ts.Node, sourceFile: ts.SourceFile): string {
        // Skip Comments & JSDoc by leveraging the typescript compiler printer if possible,
        // or walk node recursively.
        const printer = ts.createPrinter({
          removeComments: true,
          newLine: ts.NewLineKind.LineFeed
        });

        const result = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
        
        // Minimize blank lines & formatting whitespace runs
        return result
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join("\n");
      }
    }
    ```

- [ ] **Step 6: Implement CacheAligner**
    Create `src/analyze/cache_aligner.ts`:
    ```typescript
    export class CacheAligner {
      public static align(content: string): string {
        return content
          .split(/\r?\n/)
          .map(line => line.replace(/\s+/g, " ").trim())
          .filter(line => line.length > 0)
          .join("\n");
      }
    }
    ```

- [ ] **Step 7: Run test to verify it passes**
    Run: `bun test tests/analyze_pipeline.test.ts`
    Expected: PASS

- [ ] **Step 8: Commit task 3**
    Run:
    ```bash
    git add src/analyze/content_router.ts src/analyze/smart_crusher.ts src/analyze/ast_compressor.ts src/analyze/cache_aligner.ts tests/analyze_pipeline.test.ts
    git commit -m "feat: add content router, JSON smart crusher, AST compressor, and cache aligner"
    ```

---

### Task 4: Implement Reasoning Engine
**Files:**
*   Create: `src/reason/sequential_engine.ts`
*   Test: `tests/sequential_engine.test.ts`

- [ ] **Step 1: Write failing sequential engine test**
    Create `tests/sequential_engine.test.ts`:
    ```typescript
    import { expect, test, describe, beforeAll, afterAll } from "bun:test";
    import { SequentialEngine } from "../src/reason/sequential_engine.js";
    import * as fs from "fs";

    describe("Sequential Engine Tests", () => {
      const statePath = ".arive/test_thinking_state.json";

      beforeAll(() => {
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
      });

      afterAll(() => {
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
      });

      test("Thought tracking and branching", () => {
        const engine = new SequentialEngine(statePath);
        
        // Add thoughts
        engine.addThought("Hypothesis 1", 1, 3, true);
        engine.addThought("Hypothesis 2", 2, 3, true);
        
        let state = engine.getState();
        expect(state.history.length).toBe(2);
        expect(state.history[0].thought).toBe("Hypothesis 1");
        expect(state.history[1].status).toBe("active");

        // Backtrack
        engine.addThought("Revised Hyp 2", 2, 3, true, true, 1);
        
        state = engine.getState();
        // Index 1 (Hypothesis 2) should be backtracked
        expect(state.history[1].status).toBe("backtracked");
        expect(state.history[2].thought).toBe("Revised Hyp 2");
        expect(state.history[2].status).toBe("active");
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/sequential_engine.test.ts`
    Expected: FAIL (Cannot find module '../src/reason/sequential_engine.js')

- [ ] **Step 3: Implement SequentialEngine**
    Create `src/reason/sequential_engine.ts`:
    ```typescript
    import * as fs from "fs";
    import * as path from "path";

    export interface Thought {
      thoughtNumber: number;
      totalThoughts: number;
      thought: string;
      nextThoughtNeeded: boolean;
      isRevision?: boolean;
      revisesThoughtNum?: number;
      branchToThoughtNum?: number;
      timestamp: string;
      status: "active" | "backtracked";
    }

    export interface EngineState {
      history: Thought[];
      activePlan: string;
      errors: string[];
    }

    export class SequentialEngine {
      private statePath: string;
      private history: Thought[] = [];
      private activePlan: string = "";
      private errors: string[] = [];

      constructor(statePath = ".arive/thinking_state.json") {
        this.statePath = statePath;
        this.load();
      }

      private load() {
        try {
          if (fs.existsSync(this.statePath)) {
            const content = fs.readFileSync(this.statePath, "utf-8");
            const data = JSON.parse(content);
            this.history = data.history || [];
            this.activePlan = data.activePlan || "";
            this.errors = data.errors || [];
          }
        } catch (e) {
          this.history = [];
        }
      }

      private save() {
        try {
          const dir = path.dirname(this.statePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(
            this.statePath,
            JSON.stringify({ history: this.history, activePlan: this.activePlan, errors: this.errors }, null, 2),
            "utf-8"
          );
        } catch (e) {}
      }

      public addThought(
        thought: string,
        thoughtNumber: number,
        totalThoughts: number,
        nextThoughtNeeded: boolean,
        isRevision?: boolean,
        revisesThoughtNum?: number,
        branchToThoughtNum?: number
      ): EngineState {
        if (isRevision && revisesThoughtNum !== undefined) {
          // Deactivate all thoughts after the target revision index
          for (const item of this.history) {
            if (item.thoughtNumber > revisesThoughtNum) {
              item.status = "backtracked";
            }
          }
        }

        const newThought: Thought = {
          thoughtNumber,
          totalThoughts,
          thought,
          nextThoughtNeeded,
          isRevision,
          revisesThoughtNum,
          branchToThoughtNum,
          timestamp: new Date().toISOString(),
          status: "active"
        };

        this.history.push(newThought);
        this.save();
        return this.getState();
      }

      public addError(err: string) {
        this.errors.push(err);
        this.save();
      }

      public clearErrors() {
        this.errors = [];
        this.save();
      }

      public updatePlan(plan: string) {
        this.activePlan = plan;
        this.save();
      }

      public getState(): EngineState {
        return {
          history: this.history,
          activePlan: this.activePlan,
          errors: this.errors
        };
      }

      public clear() {
        this.history = [];
        this.activePlan = "";
        this.errors = [];
        this.save();
      }
    }
    ```

- [ ] **Step 4: Run test to verify it passes**
    Run: `bun test tests/sequential_engine.test.ts`
    Expected: PASS

- [ ] **Step 5: Commit task 4**
    Run:
    ```bash
    git add src/reason/sequential_engine.ts tests/sequential_engine.test.ts
    git commit -m "feat: implement reflective sequential reasoning engine"
    ```

---

### Task 5: Isolated Git Worktree Workspaces & Subagent Runners
**Files:**
*   Create: `src/integrate/workspace.ts`
*   Create: `src/integrate/subagent_runner.ts`
*   Test: `tests/integrate.test.ts`

- [ ] **Step 1: Write integration tests**
    Create `tests/integrate.test.ts`:
    ```typescript
    import { expect, test, describe, beforeAll, afterAll } from "bun:test";
    import { WorkspaceManager } from "../src/integrate/workspace.js";
    import { SubagentRunner } from "../src/integrate/subagent_runner.js";
    import * as fs from "fs";
    import { execSync } from "child_process";

    describe("Workspace & Subagent Integration Tests", () => {
      const taskId = "test_workspace_runner";
      const worktreePath = `.arive-worktrees/${taskId}`;

      beforeAll(() => {
        // Ensure standard Git commit exists so worktree works
        try {
          execSync("git rev-parse HEAD", { stdio: "ignore" });
        } catch (e) {
          execSync("git init; git config user.name 'Test'; git config user.email 'test@test.com'; git commit -m 'Initial' --allow-empty");
        }
      });

      afterAll(() => {
        try {
          WorkspaceManager.cleanup(taskId);
        } catch (e) {}
      });

      test("Create worktree workspace", () => {
        const pathResult = WorkspaceManager.create(taskId, "arive-test-branch");
        expect(pathResult).toContain(worktreePath);
        expect(fs.existsSync(worktreePath)).toBe(true);
      });

      test("Run custom command via subagent runner inside worktree", () => {
        const runRes = SubagentRunner.execute(worktreePath, "git status");
        expect(runRes.exitCode).toBe(0);
        expect(runRes.stdout).toContain("On branch");
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/integrate.test.ts`
    Expected: FAIL (Cannot find module '../src/integrate/workspace.js')

- [ ] **Step 3: Implement WorkspaceManager**
    Create `src/integrate/workspace.ts`:
    ```typescript
    import { execSync } from "child_process";
    import * as fs from "fs";
    import * as path from "path";

    export class WorkspaceManager {
      public static create(taskId: string, branchName?: string): string {
        const targetBranch = branchName || `arive-task-${taskId}`;
        const targetPath = path.join(".arive-worktrees", taskId);

        // Ensure we are inside a Git repo
        try {
          execSync("git rev-parse --git-dir", { stdio: "ignore" });
        } catch (e) {
          execSync("git init");
          execSync("git config user.name 'ARIVE Server'");
          execSync("git config user.email 'arive@mcp.local'");
          fs.writeFileSync(".gitignore", ".arive-worktrees/\n.arive/\nnode_modules/\ndist/\n", "utf-8");
          execSync("git add .gitignore && git commit -m 'chore: initialize Git and gitignore'");
        }

        // Check if target directory already exists
        if (fs.existsSync(targetPath)) {
          this.cleanup(taskId);
        }

        // Clean worktree registry if needed
        try {
          execSync(`git worktree prune`, { stdio: "ignore" });
        } catch (e) {}

        // Add the worktree
        execSync(`git worktree add -b ${targetBranch} ${targetPath}`, { stdio: "ignore" });

        return path.resolve(targetPath);
      }

      public static cleanup(taskId: string): void {
        const targetPath = path.join(".arive-worktrees", taskId);
        const branchName = `arive-task-${taskId}`;

        if (fs.existsSync(targetPath)) {
          try {
            execSync(`git worktree remove --force ${targetPath}`, { stdio: "ignore" });
          } catch (e) {}
        }

        try {
          execSync(`git branch -D ${branchName}`, { stdio: "ignore" });
        } catch (e) {}

        try {
          execSync(`git branch -D arive-test-branch`, { stdio: "ignore" });
        } catch (e) {}
      }
    }
    ```

- [ ] **Step 4: Implement SubagentRunner**
    Create `src/integrate/subagent_runner.ts`:
    ```typescript
    import { spawnSync } from "child_process";

    export interface ExecResult {
      exitCode: number;
      stdout: string;
      stderr: string;
    }

    export class SubagentRunner {
      public static execute(cwd: string, command: string): ExecResult {
        // Runs standard commands in shell relative to workspace cwd
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "powershell.exe" : "sh";
        const arg = isWindows ? "-Command" : "-c";

        const proc = spawnSync(shell, [arg, command], {
          cwd,
          encoding: "utf-8",
          env: {
            ...process.env,
            PAGER: "cat",
            FORCE_COLOR: "0" // Keep output logs color-free for parsing
          }
        });

        return {
          exitCode: proc.status ?? 1,
          stdout: proc.stdout || "",
          stderr: proc.stderr || ""
        };
      }
    }
    ```

- [ ] **Step 5: Run test to verify it passes**
    Run: `bun test tests/integrate.test.ts`
    Expected: PASS

- [ ] **Step 6: Commit task 5**
    Run:
    ```bash
    git add src/integrate/workspace.ts src/integrate/subagent_runner.ts tests/integrate.test.ts
    git commit -m "feat: implement Git worktree isolator and subprocess runner"
    ```

---

### Task 6: TDD Runner & Backprop Verification Loop
**Files:**
*   Create: `src/verify/tdd_runner.ts`
*   Create: `src/verify/validator.ts`
*   Test: `tests/verify.test.ts`

- [ ] **Step 1: Write TDD verification tests**
    Create `tests/verify.test.ts`:
    ```typescript
    import { expect, test, describe, beforeAll, afterAll } from "bun:test";
    import { TDDRunner } from "../src/verify/tdd_runner.js";
    import { Validator } from "../src/verify/validator.js";
    import { SequentialEngine } from "../src/reason/sequential_engine.js";
    import * as fs from "fs";

    describe("TDD & Verification Tests", () => {
      const statePath = ".arive/test_thinking_verify.json";

      beforeAll(() => {
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
      });

      afterAll(() => {
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
      });

      test("TDD error parsing logic", () => {
        const errorContent = `
          FAIL tests/test.ts
          Error: Expected 'foo' to be 'bar'
          at Object.<anonymous> (tests/test.ts:10:12)
        `;
        const failures = TDDRunner.parseFailures(errorContent);
        expect(failures.length).toBe(1);
        expect(failures[0]).toContain("Expected 'foo'");
      });

      test("Backprop reflex feedback loop integration", () => {
        const engine = new SequentialEngine(statePath);
        engine.addThought("Reason step", 1, 3, true);

        const failures = ["Test failure line 20"];
        Validator.backpropagate(engine, failures);

        const state = engine.getState();
        expect(state.errors.length).toBe(1);
        expect(state.errors[0]).toBe("Test failure line 20");
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/verify.test.ts`
    Expected: FAIL (Cannot find module '../src/verify/tdd_runner.js')

- [ ] **Step 3: Implement TDDRunner**
    Create `src/verify/tdd_runner.ts`:
    ```typescript
    import { SubagentRunner } from "../integrate/subagent_runner.js";

    export class TDDRunner {
      public static run(cwd: string, testCommand: string): { success: boolean; failures: string[]; output: string } {
        const result = SubagentRunner.execute(cwd, testCommand);
        const combinedOutput = `${result.stdout}\n${result.stderr}`;
        const failures = this.parseFailures(combinedOutput);

        return {
          success: result.exitCode === 0 && failures.length === 0,
          failures,
          output: combinedOutput
        };
      }

      public static parseFailures(output: string): string[] {
        const lines = output.split("\n");
        const failures: string[] = [];

        // Detect failure signatures from common runners (bun, jest, pytest, cargo)
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("FAIL") ||
            trimmed.includes("Error:") ||
            trimmed.includes("Exception:") ||
            trimmed.startsWith("assertion failed") ||
            trimmed.startsWith("failed:")
          ) {
            failures.push(trimmed);
          }
        }

        return failures;
      }
    }
    ```

- [ ] **Step 4: Implement Validator**
    Create `src/verify/validator.ts`:
    ```typescript
    import { SequentialEngine } from "../reason/sequential_engine.js";
    import { createHash } from "crypto";

    export class Validator {
      public static backpropagate(engine: SequentialEngine, failures: string[]): void {
        engine.clearErrors();
        for (const fail of failures) {
          engine.addError(fail);
        }
      }

      public static verifyHash(content: string, expectedHash: string): boolean {
        // Expected hash comes in format ccr:sha256
        const cleanHash = expectedHash.replace(/^ccr:/, "");
        const computed = createHash("sha256").update(content).digest("hex");
        return computed === cleanHash;
      }
    }
    ```

- [ ] **Step 5: Run test to verify it passes**
    Run: `bun test tests/verify.test.ts`
    Expected: PASS

- [ ] **Step 6: Commit task 6**
    Run:
    ```bash
    git add src/verify/tdd_runner.ts src/verify/validator.ts tests/verify.test.ts
    git commit -m "feat: implement test runner parses and backtracking backprop verification"
    ```

---

### Task 7: Lithic (Caveman) Grammatical Compressor
**Files:**
*   Create: `src/explain/lithic_formatter.ts`
*   Test: `tests/lithic_formatter.test.ts`

- [ ] **Step 1: Write failing formatter tests**
    Create `tests/lithic_formatter.test.ts`:
    ```typescript
    import { expect, test, describe } from "bun:test";
    import { LithicFormatter } from "../src/explain/lithic_formatter.js";

    describe("Lithic Formatter Tests", () => {
      test("Lite brevity level", () => {
        const input = "Please look at this. We literally just updated the configuration file.";
        const formatted = LithicFormatter.format(input, "lite");
        expect(formatted).not.toContain("literally");
        expect(formatted).not.toContain("just");
      });

      test("Full brevity level (default)", () => {
        const input = "The server is running on the local port and it has successfully verified the results.";
        const formatted = LithicFormatter.format(input, "full");
        expect(formatted).not.toContain("The");
        expect(formatted).not.toContain("is");
        expect(formatted).not.toContain("the");
        expect(formatted).not.toContain("has");
        expect(formatted).toContain("Server");
      });

      test("Ultra brevity level", () => {
        const input = "Run test suite. Task failed inside file tests/verify.test.ts at line number 24.";
        const formatted = LithicFormatter.format(input, "ultra");
        expect(formatted).toContain("Run test. Task fail tests/verify.test.ts:24");
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/lithic_formatter.test.ts`
    Expected: FAIL (Cannot find module '../src/explain/lithic_formatter.js')

- [ ] **Step 3: Implement LithicFormatter**
    Create `src/explain/lithic_formatter.ts`:
    ```typescript
    export class LithicFormatter {
      public static format(message: string, brevity: "lite" | "full" | "ultra" | "normal" = "full"): string {
        if (brevity === "normal") {
          return message;
        }

        let txt = message;

        // 1. Lite: Filter conversational padding & hedging
        const conversationalPadding = [
          /\bplease\b/gi,
          /\bliterally\b/gi,
          /\bjust\b/gi,
          /\bactually\b/gi,
          /\bbasically\b/gi,
          /\bsimply\b/gi,
          /\bkind of\b/gi,
          /\bsort of\b/gi,
          /\bhonestly\b/gi
        ];

        for (const pattern of conversationalPadding) {
          txt = txt.replace(pattern, "");
        }

        if (brevity === "lite") {
          return txt.replace(/\s+/g, " ").trim();
        }

        // 2. Full: Remove articles, basic helper/auxiliary verbs
        if (brevity === "full" || brevity === "ultra") {
          const fullFilters = [
            /\b(the|a|an)\b/gi,
            /\b(is|are|was|were|been)\b/gi,
            /\b(have|has|had)\b/gi,
            /\b(do|does|did)\b/gi,
            /\b(successfully|extremely|highly|properly)\b/gi
          ];

          for (const pattern of fullFilters) {
            txt = txt.replace(pattern, "");
          }
        }

        // 3. Ultra: Map aggressively to keyword fragments
        if (brevity === "ultra") {
          // Replace common wordings with direct tags
          txt = txt
            .replace(/\bline number\s+(\d+)\b/gi, ":$1")
            .replace(/\bat line\s+(\d+)\b/gi, ":$1")
            .replace(/\bfile\s+([^\s]+)\b/gi, "$1")
            .replace(/\bsuite\b/gi, "")
            .replace(/\bfailed\b/gi, "fail")
            .replace(/\bpassed\b/gi, "pass")
            .replace(/\bcompleted\b/gi, "done");
        }

        // Clean up redundant double spaces and spaces around punctuations
        return txt
          .replace(/\s+/g, " ")
          .replace(/\s+([.,:;!])/g, "$1")
          .trim();
      }

      public static getSavings(original: string, formatted: string): string {
        const origTokens = original.split(/\s+/).length;
        const formTokens = formatted.split(/\s+/).length;
        const reduction = origTokens > 0 ? Math.round(((origTokens - formTokens) / origTokens) * 100) : 0;
        return `${reduction}% token reduction (${origTokens} -> ${formTokens} tokens)`;
      }
    }
    ```

- [ ] **Step 4: Run test to verify it passes**
    Run: `bun test tests/lithic_formatter.test.ts`
    Expected: PASS

- [ ] **Step 5: Commit task 7**
    Run:
    ```bash
    git add src/explain/lithic_formatter.ts tests/lithic_formatter.test.ts
    git commit -m "feat: implement lithic (caveman) grammatical reduction compressor"
    ```

---

### Task 8: Entrypoint & MCP Server Initialization
**Files:**
*   Create: `src/index.ts`
*   Test: `tests/index.test.ts`

- [ ] **Step 1: Write integration tests for the full server routing**
    Create `tests/index.test.ts`:
    ```typescript
    import { expect, test, describe } from "bun:test";
    import { execSync } from "child_process";

    describe("MCP Entrypoint Shell Run Tests", () => {
      test("TypeScript file compiles", () => {
        const compile = execSync("bun tsc --noEmit");
        expect(compile).toBeDefined();
      });
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
    Run: `bun test tests/index.test.ts`
    Expected: FAIL (Tsc errors or Cannot find entrypoint)

- [ ] **Step 3: Implement src/index.ts**
    Create `src/index.ts`:
    ```typescript
    import { Server } from "@modelcontextprotocol/sdk/server/index.js";
    import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
    import {
      CallToolRequestSchema,
      ListToolsRequestSchema,
    } from "@modelcontextprotocol/sdk/common/mcp.js";
    import { ContentRouter } from "./analyze/content_router.js";
    import { SmartCrusher } from "./analyze/smart_crusher.js";
    import { ASTCompressor } from "./analyze/ast_compressor.js";
    import { CacheAligner } from "./analyze/cache_aligner.js";
    import { CCRRegistry } from "./analyze/ccr_registry.js";
    import { SequentialEngine } from "./reason/sequential_engine.js";
    import { WorkspaceManager } from "./integrate/workspace.js";
    import { TDDRunner } from "./verify/tdd_runner.js";
    import { Validator } from "./verify/validator.js";
    import { LithicFormatter } from "./explain/lithic_formatter.js";

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
            const isRev = Boolean(args?.isRevision);
            const revNum = args?.revisesThoughtNum !== undefined ? Number(args.revisesThoughtNum) : undefined;
            const branchNum = args?.branchToThoughtNum !== undefined ? Number(args.branchToThoughtNum) : undefined;

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
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ARIVE MCP Server successfully listening on stdio.");
    ```

- [ ] **Step 4: Run compilation check**
    Run: `bun test tests/index.test.ts`
    Expected: PASS

- [ ] **Step 5: Commit task 8**
    Run:
    ```bash
    git add src/index.ts tests/index.test.ts
    git commit -m "feat: wire up MCP server entrypoint and route tools"
    ```
