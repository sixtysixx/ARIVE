# Code Index: ./src

<details>
<summary>📄 <code>analyze/ast_compressor.ts</code></summary>

Imports: typescript

**Exports:**
- class ASTCompressor
  - compress()
  - compressMultiLanguage()
</details>

<details>
<summary>📄 <code>analyze/ccr_registry.ts</code></summary>

Imports: bun:sqlite, crypto, fs, path

**Exports:**
- class CCRRegistry
  - store()
  - retrieve()
  - prune()
  - clear()
  - close()
</details>

<details>
<summary>📄 <code>analyze/codetree.ts</code></summary>

Imports: fs, path, child_process, typescript

**Exports:**
- class CodeTreeScanner
  - scanTree()
  - traverse()
  - parseFileMetadata()
  - getGitDiff()
  - scanDependencies()
  - collectDependencies()
  - writeCodeIndex()
  - collectIndexFiles()
- interface FileMeta
</details>

<details>
<summary>📄 <code>cli/init_hooks.ts</code></summary>

Imports: fs, path, readline

**Exports:**
- writeHookFileWithConflict()
- installPreCommitHookSync()
- installPreCommitHook()
</details>

<details>
<summary>📄 <code>cli/installer.ts</code></summary>

Imports: fs, path, os, readline, ./init_hooks.js

**Exports:**
- writeRuleFileWithConflict()
- runInteractiveInstall()
- installAllAsync()
- installAll()
- uninstallAllAsync()
- runInstallerCli()
</details>

<details>
<summary>📄 <code>cli/prompt_generator.ts</code></summary>

Imports: fs, path

**Exports:**
- outputAdvancedPrompt()
</details>

<details>
<summary>📄 <code>index.ts</code></summary>

Imports: @modelcontextprotocol/sdk/server/index.js, @modelcontextprotocol/sdk/server/stdio.js, @modelcontextprotocol/sdk/types.js, ./analyze/content_router.js, ./analyze/smart_crusher.js, ./analyze/ast_compressor.js, ./analyze/cache_aligner.js, ./analyze/ccr_registry.js, ./analyze/codetree.js, ./reason/sequential_engine.js, ./reason/memory_bank.js, ./integrate/workspace.js, ./integrate/hook_manager.js, ./verify/tdd_runner.js, ./verify/validator.js, ./explain/fade_formatter.js, ./mcp/compact.js, fs, path, ./cli/installer.js, ./cli/prompt_generator.js
</details>

<details>
<summary>📄 <code>integrate/hook_manager.ts</code></summary>

Imports: fs, path, child_process

**Exports:**
- class HookManager
  - runHook()
</details>

<details>
<summary>📄 <code>integrate/subagent_runner.ts</code></summary>

Imports: child_process, fs, path

**Exports:**
- class SubagentRunner
  - execute()
- interface ExecResult
</details>

<details>
<summary>📄 <code>integrate/workspace.ts</code></summary>

Imports: fs, path

**Exports:**
- class WorkspaceManager
  - validateTaskId()
  - getTaskPath()
  - create()
  - list()
  - cleanup()
- interface WorkspaceInfo
</details>

<details>
<summary>📄 <code>mcp/compact.ts</code></summary>

Imports: ../integrate/hook_manager.js, ../analyze/ccr_registry.js

**Exports:**
- createCompactHelpers()
- interface CompactResult
- interface CompactText
- interface CompactObject
- interface CompactHelpers
</details>

<details>
<summary>📄 <code>reason/memory_bank.ts</code></summary>

Imports: bun:sqlite, crypto, fs, path

**Exports:**
- class MemoryBank
  - write()
  - read()
  - forget()
  - list()
  - recall()
  - stats()
  - close()
  - rowToEntry()
  - prune()
- parseRememberIntent()
- interface MemoryEntry
- interface RememberIntent
</details>

<details>
<summary>📄 <code>reason/sequential_engine.ts</code></summary>

Imports: bun:sqlite, fs, path

**Exports:**
- class SequentialEngine
  - initDb()
  - addThought()
  - modifyState()
  - addError()
  - clearErrors()
  - setErrors()
  - updatePlan()
  - getInternalState()
  - saveInternalState()
  - getState()
  - clear()
  - close()
  - evaluateConsensus()
- interface Thought
- interface EngineState
- interface PersonaAudit
- interface ConsensusReport
</details>

<details>
<summary>📄 <code>verify/tdd_runner.ts</code></summary>

Imports: child_process, fs

**Exports:**
- class TDDRunner
  - run()
</details>

<details>
<summary>📄 <code>verify/validator.ts</code></summary>

Imports: ../reason/sequential_engine.js, crypto

**Exports:**
- class Validator
  - backpropagate()
  - verifyHash()
</details>
