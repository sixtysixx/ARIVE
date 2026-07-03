# ARIVE Codebase Audit Report

Based on the deep-dive analysis of the ARIVE MCP server engine, here is the prioritized list of refactoring tasks grouped by Critical Fixes (Reliability/Security) and Enhancements (DX/Performance).

## 1. Architecture Verification (State & Sandboxing)
* **Critical Fix (Concurrency & State Corruption):** In `SequentialEngine.ts`, `addThought` performs multiple database operations (e.g., an `UPDATE` followed by an `INSERT` when `isRevision` is true). Since it relies on Bun's synchronous SQLite without a `BEGIN TRANSACTION` block, concurrent MCP requests or agent threads sharing the same `sessionId` can interleave operations, leading to corrupted engine state and orphaned history.
* **Enhancement (Sandbox Efficiency):** `WorkspaceManager.create` copies the entire working directory using `fs.cpSync`, explicitly excluding specific folders. In large mono-repos, this synchronous copy is expensive and blocks the event loop. Furthermore, it does not explicitly prevent traversing or resolving symlinks, which could unintentionally include out-of-scope files.

## 2. Protocol Rigor (Hooks & Parameter Handling)
* **Critical Fix (Protocol Hangs):** `HookManager.runHook` utilizes `spawnSync` to execute arbitrary external hook scripts but fails to define a `timeout`. If a hook script hangs (e.g., an infinite loop or a blocked network request), the entire MCP server will hang indefinitely, breaking the protocol lifecycle.
* **Enhancement (Edge Case Parameter Handling):** In `arive_think`, parameters like `tNum`, `total`, and `branchNum` are cast using `Number()`. If parameters are omitted, `Number(undefined)` evaluates to `NaN`. While there is an `isNaN` check for `branchNum`, failing to enforce strict schemas for required primitives can cause silent failures or corrupted JSON state if unhandled early in the tool definition.

## 3. TDD Loop Efficacy (Backprop Reflex)
* **Critical Fix (Blindness to Logic Errors):** `TDDRunner.run` extracts failures by splitting standard output line-by-line and applying a primitive regex: `/(FAIL|failing|Error:|Exception|failed)/i`. This completely misses critical assertion failures common in logic errors (e.g., "Expected: 42, Received: 0") and strips away multi-line contexts (like stack traces or multi-line object diffs) because it treats each line independently.
* **Enhancement (Backprop Context Limits):** The regex line-matching only stores the raw matched line and slices at the first 10 matches. Consequently, `Validator.backpropagate(engine, res.failures)` feeds the `Reasoning Engine` fragmented context devoid of the actual root cause, making self-correction extremely unreliable.

## 4. Performance & Compression (AST & Smart JSON)
* **Critical Fix (Code Corruption via ASTCompressor):** In `ASTCompressor.compress`, an AST traversal is computed (`visit(sourceFile)`), but the accumulated result is completely discarded. The method instead returns the original `code` modified by aggressive regex: `replace(/\s+/g, " ")`. Replacing all newlines and whitespace with single spaces breaks Automatic Semicolon Insertion (ASI) and corrupts multi-line string literals, resulting in syntactically invalid TypeScript/JavaScript.
* **Enhancement (Type Corruption in SmartCrusher):** `SmartCrusher.traverseAndCrush` limits arrays to two elements and injects a string (`"<truncated X items>"`) at the end of the array. If the target JSON expects strongly typed arrays (e.g., `number[]`), injecting a string will break type enforcement in downstream integrations or LLM parsers.

## 5. Security & Hardening (Command Injection & Traversal)
* **Critical Fix (Directory Traversal):** The `arive_codemap` tool accepts a `dir` parameter and passes it directly to `CodeMapScanner.scanTree` without anchoring or validating it against the workspace root. A malicious or hallucinating subagent can pass `dir: "../../../"` to enumerate the entire host filesystem.
* **Critical Fix (Command Injection via Shell):** In both `TDDRunner.run` and `SubagentRunner.execute`, arbitrary commands (`testCommand` and `command`) are executed with `shell: true` or passed to `sh -c`. While `SubagentRunner` validates the `cwd` directory, it does nothing to sanitize the command string itself, allowing trivial arbitrary code execution (e.g., `bun test && cat /etc/passwd`).
* **Critical Fix (Argument Injection):** `CodeMapScanner.getGitDiff` sanitizes `targetBranch` using `/^[a-zA-Z0-9_\-\/\.\+]+$/`. This regex allows strings starting with a hyphen. Passing a branch name like `--no-index` or `--output` could cause git argument injection, leading to unintended file reads or writes.
