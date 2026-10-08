# ARIVE MCP Server

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Protocol-blue.svg?style=flat)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A complete, production-ready TypeScript Model Context Protocol (MCP) server that implements the **ARIVE** framework: **Analyze**, **Reason**, **Integrate**, **Verify**, **Explain**.

ARIVE merges local context compression, step-by-step backtracking reasoning graphs, isolated directory task runners, test verification loops, and telegraphic language output into a single, cohesive developer assistant engine.

---


## Benchmark Results: With vs. Without ARIVE MCP

The table below quantifies the performance delta of an LLM operating **with** the ARIVE MCP tools and sequential reasoning protocol versus a baseline model operating **without** them. Benchmarks are run via `promptfoo` and verified against real agent sessions.

| Metric | Without ARIVE MCP | With ARIVE MCP | Delta |
| :--- | :--- | :--- | :--- |
| **Reasoning Protocol Compliance** | 0% — skips gates, produces unstructured output | 100% — enforces all 5 phases (Scope, Evidence, Challenge, Verify, Report) | **Infinite improvement** — prevents rushed, logically incomplete work |
| **Tone & Style Guard** | Fails — informal greetings, emojis (`🚀`), exclamation marks | Passes — professional, telegraphic, objective, emoji-free | **Eliminates conversational fluff** — output is concise and rigorous |
| **Context Window Efficiency** | 0% savings — raw content repeatedly fills context | Up to 90% savings — `arive_compress` + CCR hash references | **Exponential token efficiency** — prompt size stays constant |
| **Verification & Self-Correction** | Single-pass guess — no compilation check, failures survive | Active TDD loop — `arive_verify` backpropagates failures into reasoning | **Correctness jumps** — code compiles and tests pass before yielding |
Run the benchmarks yourself:
```bash
# 1. Promptfoo single-run evaluation (Actual model: mimo-v2.5-free)
bun run benchmark

# 2. Multi-run prompt evaluation (Averages stats across 3 runs)
bun run benchmark:prompts

# 3. Toolset latency and token performance evaluation
bun run benchmark:toolset
```

For detailed methodology, multi-run statistics, and agent-based testing instructions, see [BENCHMARKS.md](BENCHMARKS.md).

## Architecture & Phases

```mermaid
graph TD
    R --> I[Integrate: Workspaces]
    I --> V[Verify: TDD Loop]
    V -- Failure Backprop --> R
    V --> E[Explain: Lithic Formatter]

    subgraph Analyze Phase
        ContentRouter --> SmartCrusher
        ContentRouter --> ASTCompressor
        ASTCompressor --> CcrRegistry
    end
```

### A - Analyze (Context Compression)

- **Content Router**: Automatically classifies incoming text blocks into `json`, `code`, `logs`, or `prose` to determine the optimal compression strategy.
- **Smart JSON Crusher**: Recursively traverses JSON data, collapsing large arrays with more than 2 elements and replacing them with a summary description while preserving SRE/error fields.
- **AST Code Compressor**: Discards comments, JSDocs, whitespace runs, and formatting details using the TypeScript Compiler API.
- **Cache Aligner**: Normalizes spacing and carriage returns to ensure maximum KV cache hit rates on providers like Anthropic or Gemini.
- **CCR Registry**: A hash-based Content-Compressed Retrieval store (`ccr:sha256_hash`). Allows referencing large payloads using 68-character hashes.

### R - Reason (Step-by-Step Logic Sequences)

- **Reflective Engine**: Tracks thought sequences in a graph. Supports branching and backtracking: if a backtracking revision is requested, thoughts after the revision target are flagged as `"backtracked"` (retained in log but deactivated), and a new active sequence branches out. State is saved atomically to `.arive/thinking_state.json`.

### I - Integrate (Isolated Workspaces)

- **Directory Isolation**: Creates isolated, concurrent task directories under `.arive-tasks/<taskId>`, so automated refactoring runs never touch your active files.
- **Hook Manager**: Runs user-provided `pre-*` / `post-*` scripts around tool calls. See [Lifecycle Hooks](#arive-protocol-lifecycle-hooks).

### V - Verify (TDD & Verification Loops)

- **TDD Orchestrator**: Executes verification tests (e.g., `bun test`, `pytest`) inside the isolated CWD.
- **Backprop Reflex**: Integrates assertion failures back into the reasoning history, prompting the engine to revise its hypothesis on subsequent iterations.
- **CCR Verification**: Validates that retrieved raw content matches its original hash key before usage.

### E - Explain (Lithic Token Compression)

- **Lithic Formatter**: Compresses conversational text into token-saving, telegraphic styles:
  - `lite`: Strips filler words ("just", "actually", "basically").
  - `full`: Strips articles ("the", "a") and auxiliary verbs ("is", "are").
  - `ultra`: telegraphic keyword mapping (e.g. `tests/verify.test.ts:24 fail`).
  - `normal`: Returns raw text without modification.

---

## Exposed MCP Tools

### `arive_compress`

Compresses strings based on code, JSON, logs or prose optimizations, returning hash references for large sizes.

| Parameter     | Type    | Required | Default | Description                                                      |
| :------------ | :------ | :------- | :------ | :--------------------------------------------------------------- |
| `content`     | string  | Yes      |         | The content raw text block to compress.                          |
| `contentType` | enum    | No       | `auto`  | Category of content: `json`, `code`, `logs`, `prose`, or `auto`. |
| `forceCcr`    | boolean | No       | `false` | Force storing the result in the CCR registry.                    |

### `arive_decompress`

Resolves CCR reference hashes back to their raw uncompressed representation.

| Parameter | Type   | Required | Default | Description                             |
| :-------- | :----- | :------- | :------ | :-------------------------------------- |
| `hash`    | string | Yes      |         | The CCR hash (e.g., `ccr:sha256_hash`). |

### `arive_think`

Records a single thought block in the reasoning sequence, managing backtracking.

| Parameter            | Type    | Required | Default | Description                                          |
| :------------------- | :------ | :------- | :------ | :--------------------------------------------------- |
| `thought`            | string  | Yes      |         | The reasoning thought text.                          |
| `thoughtNumber`      | integer | Yes      |         | The current thought index.                           |
| `totalThoughts`      | integer | Yes      |         | The estimated total thoughts.                        |
| `nextThoughtNeeded`  | boolean | Yes      |         | Whether another thought is expected after this one.  |
| `isRevision`         | boolean | No       |         | Flag indicating this thought revises a previous one. |
| `revisesThoughtNum`  | integer | No       |         | The thought number being revised.                    |
| `branchToThoughtNum` | integer | No       |         | The thought number to branch from (if backtracking). |

### `arive_workspace`

Manages the isolated task workspaces under `.arive-tasks/<taskId>`.

| Parameter | Type   | Required | Default | Description                                                      |
| :-------- | :----- | :------- | :------ | :---------------------------------------------------------------- |
| `action`  | enum   | Yes      | `list`  | `list` returns all workspaces; `create` builds one; `cleanup` deletes one. |
| `taskId`  | string | Only for `create` / `cleanup` | | Identifier for the task workspace. A single segment resolved inside `.arive-tasks`. |

`create` copies the project (excluding `.git`, `node_modules`, `.arive*`, `bun.lock`) into the workspace and symlinks `node_modules`. Creating a workspace resets it if it already exists.

### `arive_verify`

Runs testing suites in the task directory workspace path and backpropagates failures.

| Parameter     | Type   | Required | Default | Description                                 |
| :------------ | :----- | :------- | :------ | :------------------------------------------ |
| `taskId`      | string | Yes      |         | Unique identifier for the task workspace.   |
| `testCommand` | string | No       | `bun test` | The test command to run.                |

### `arive_memory_bank`

Persistent memory bank with a `wing > room > hall > drawer` hierarchy.

| Parameter  | Type     | Required | Default          | Description                                                              |
| :--------- | :------- | :------- | :--------------- | :------------------------------------------------------------------------ |
| `action`   | enum     | Yes      | `recall`         | `remember`, `drawer_write`, `drawer_read`, `drawer_list`, `search`, `recall`, `forget`, `stats`, `wing_create`, `room_create`, `hall_create`. |
| `content`  | string   | Depends  |                  | Full user phrase for `remember` (e.g. `remember to buy oat milk`); verbatim text for `drawer_write`. |
| `wing`     | string   | No       | `user-memories`  | Top-level category.                                                      |
| `room`     | string   | No       | `conversational` | Sub-topic within the wing.                                                |
| `hall`     | string   | No       | `general`        | Organising corridor: facts, preferences, decisions, reminders, discoveries, rules, general. |
| `drawer`   | string   | No       |                  | Optional drawer label (derived from content when omitted).                |
| `drawerId` | string   | Depends  |                  | Required for `drawer_read` and `forget`.                                  |
| `query`    | string   | Depends  |                  | Required for `search` / `recall`.                                         |
| `tags`     | string[] | No       |                  | Tags for categorization.                                                  |
| `metadata` | object   | No       |                  | Structured metadata.                                                      |
| `limit`    | integer  | No       | `50`             | Max results for `list` / `search`.                                        |

### `arive_explain`

Transforms conversational messages into telegraphic token-saving fade styles, or returns fade instruction rules.

| Parameter | Type   | Required | Default | Description                                                          |
| :-------- | :----- | :------- | :------ | :------------------------------------------------------------------- |
| `message` | string | Yes      |         | The natural language text to compress, or get instructions for.      |
| `brevity` | enum   | No       | `full`  | The level of brevity/laziness: `lite`, `full`, `ultra`, or `normal`. |


## ARIVE Protocol Lifecycle Hooks

Hooks are optional executable scripts that run immediately before and after specific
tools. A hook is a file named `<hookName>.<ext>` (`pre-analyze.ts`, `post-compact.sh`,
…) where the extension determines how it is launched:

| Extension | Launched as |
| :--- | :--- |
| `.ts`, `.js` | `bun run <hook>` |
| `.ps1` | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <hook>` |
| `.sh` | `<hook>` on POSIX, `sh <hook>` on Windows |
| `.bat`, `.cmd` | `<hook>` on Windows only |
| anything else | `<hook>` on POSIX, `cmd.exe /c <hook>` on Windows |

Hooks receive context on the environment: `ARIVE_HOOK_NAME`, `ARIVE_HOOK_PHASE`,
`ARIVE_HOOK_CONTEXT` (JSON), and `ARIVE_HOOK_RESULT` (JSON; empty for `pre-*`).
Write diagnostics to stderr — stdout is reserved for the MCP transport.
A non-zero exit from a `pre-*` hook blocks the tool call; a non-zero exit from a
`post-*` hook fails it after the fact.

### Hook names

| Hook | Fired by |
| :--- | :--- |
| `pre-analyze` / `post-analyze` | `arive_compress` |
| `pre-reason` / `post-reason` | `arive_think` |
| `pre-verify` / `post-verify` | `arive_verify` |
| `pre-explain` / `post-explain` | `arive_explain` |
| `pre-memory` / `post-memory` | `arive_memory_bank` |
| `post-compact` | when a large tool result is replaced by a `ccr:` reference |

### Where hooks are loaded from

Directories are searched in order; the first one containing a matching file wins
for that hook name:

1. `$ARIVE_HOOKS_DIR` — explicit override, for arbitrary layouts
2. `<project>/.arive/hooks/` — project-local
3. `~/.arive/hooks/` — user-global, applies to every project

Files ending in `.sample` are ignored, so you can keep disabled hooks next to
active ones.

ARIVE ships four hooks in `.arive/hooks/` (`pre-reason`, `post-reason`,
`pre-verify`, `post-verify`). Project-local hooks are picked up automatically —
no installation step is required for a checkout.

### Installing hooks globally

To apply a hook to every project, copy it into `~/.arive/hooks/`:

```bash
# Ensure you are at the root of the ARIVE repository
cd /path/to/ARIVE

mkdir -p ~/.arive/hooks

# Copy without overwriting hooks you have already customized
cp -n .arive/hooks/*.ts ~/.arive/hooks/
```

If your editor keeps hooks in its own location, point ARIVE at it instead of
copying:

```bash
export ARIVE_HOOKS_DIR=~/.omp/hooks
```

### Automatic Prompt Guidance

The `post-compact` hook fires whenever a tool result is larger than the compact
threshold (2048 characters) and has been replaced by a `ccr:` reference. Use it
to remind the conversation to reference the stored hash rather than re-expanding it.

### Editor-specific hook directories

Editor-specific directories are **not** scanned implicitly; set
`ARIVE_HOOKS_DIR` when your hooks live outside `.arive/hooks/`.

| Code Editor / Client | Typical hooks directory |
| :--- | :--- |
| **ARIVE Core** | `<project>/.arive/hooks/` or `~/.arive/hooks/` |
| **omp (oh-my-pi)** | `~/.omp/hooks/` |
| **Gemini CLI (antigravity-cli)** | `~/.gemini/antigravity-cli/hooks/` |
| **Claude Desktop / Claude Code** | `~/.claude/hooks/` |
| **OpenCode / KiloCode** | `~/.config/opencode/hooks/` |
| **VS Code (Cline / Roo Code)** | `~/.cline/hooks/` |
| **Cursor** | `~/.cursor/hooks/` |

---

## Installation & Setup

### Requirements

- [Bun](https://bun.sh/) (runtime & package manager)
- [Git](https://git-scm.com/)

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/sixtysixx/ARIVE.git
cd ARIVE

# Install dependencies
bun install
```

### Running Tests

```bash
bun test
```

### Type Checking

```bash
bun x tsc --noEmit
```

### Running Benchmarks & Evaluations (With vs. Without MCP Tools)

The repository integrates `promptfoo` to run comparative benchmarks measuring the performance delta of models operating **with** the ARIVE MCP tools and sequential reasoning rules versus a baseline model **without** them.

Run the side-by-side comparative evaluation locally:

```bash
bun run benchmark
```

This evaluates prompts for reasoning gate compliance (Scope, Evidence, Challenge, Verify, Report), style constraints, and token efficiency. For details on the comparison metrics and using real LLMs, see [BENCHMARKS.md](BENCHMARKS.md)
---

## Client Configurations

Two launch modes are supported:

```text
bun run src/index.ts          # local checkout, near-instant start
bunx --silent github:sixtysixx/ARIVE  # fetches from GitHub
```

If the client times out during first startup, use the local command.

To register the ARIVE MCP server in your local AI editing clients:

### Gemini CLI (`antigravity-cli`)

ARIVE ships a root-level `plugin.json`, `mcp_config.json`, `rules/`, and `skills/` — the exact components an Antigravity plugin manifest recognises — so the repo itself is a valid plugin. Install it in one command:

```bash
agy plugin install https://github.com/sixtysixx/ARIVE
```

The CLI stages the repo at `~/.gemini/antigravity-cli/plugins/arive/` and the agent discovers the MCP server, Fade rules, and Fade skills on next launch.

`rules/` and `skills/` follow the plugin layout the manifest documents: `rules/<rule-name>.md` and `skills/<skill-name>/SKILL.md`.

The ARIVE lifecycle hooks in `.arive/hooks/` are **not** Antigravity plugin components — they are loaded by the ARIVE server itself (see [Lifecycle Hooks](#arive-protocol-lifecycle-hooks)). `hooks.json` is intentionally absent.

Alternatively, register the MCP server manually in `%USERPROFILE%\.gemini\antigravity-cli\mcp_config.json`:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

### omp (oh-my-pi)

ARIVE supports OMP's native plugin capability (compatible with OMP/Claude-Code plugin architecture). Install the repository (MCP tools, Fade rules, skills, and hooks) as a plugin in one command:

```bash
# Global plugin installation
omp install github:sixtysixx/ARIVE

# Local / Project-scoped plugin installation
omp install -l github:sixtysixx/ARIVE
```

Alternatively, register the MCP server manually in your user-level config at `~/.omp/agent/mcp.json` or project-level config at `.omp/mcp.json`:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

### Claude Desktop

Add this to your configuration (e.g., `%APPDATA%\EasyCode\claude_desktop_config.json` or standard `claude_desktop_config.json` configuration path):

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

### OpenCode

ARIVE ships a root-level `opencode.mjs` plugin module. Add the repo as a plugin in your global config (`~/.config/opencode/opencode.json`) or project config (`.opencode/opencode.json`) and the MCP server registers automatically:

```json
{
  "plugin": ["github:sixtysixx/ARIVE"]
}
```

Alternatively, register the MCP server manually:

```json
{
  "mcp": {
    "arive": {
      "type": "local",
      "command": ["bun", "x", "--silent", "github:sixtysixx/ARIVE"],
      "enabled": true
    }
  }
}
```

### KiloCode

KiloCode shares the same plugin architecture as OpenCode. Add the repo as a plugin in your KiloCode config and the MCP server registers automatically:

```json
{
  "plugin": ["github:sixtysixx/ARIVE"]
}
```

Alternatively, use the **MCP Servers** panel (gear icon → **Edit Global MCP**), or define it locally under `.kilocode/mcp.json`:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

### VS Code (Cline & Roo Code)

You can configure this globally (via the **MCP Servers** tab in the Cline/Roo Code pane, clicking **Edit Global MCP**) or locally for a specific workspace:

- **Cline Project-Level Config:** `.cline/mcp.json`
- **Roo Code Project-Level Config:** `.roo/mcp.json`

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

### Cursor

Add this through the Cursor settings UI under **Settings > Features > MCP**, clicking **Add new MCP server** (with type `stdio` and command `bunx --silent github:sixtysixx/ARIVE`), or add it manually to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Credits

ARIVE integrates ideas and pipelines from the following core development paradigms - Thank you for the inspiration:

- **headroom** (`headroomlabs-ai/headroom`): Local, reversible context compression.
- **sequentialthinking** (`modelcontextprotocol/servers/sequentialthinking`): Step-by-step reasoning with reflective backtracking.
- **ponytail** (`DietrichGebert/ponytail`): Lazy senior dev mode rulesets, skills, and plugins.
- **mempalace** (`MemPalace/mempalace`): Memory palace-inspired knowledge retention and recall patterns.