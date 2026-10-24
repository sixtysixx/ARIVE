# ARIVE

A unified MCP gateway that exposes six specialist namespaces (`think`, `mem`, `lsp`, `dap`, `search`, `context`) behind one stdio server, with strict tool prefixing, reversible output compression, and graceful degradation when a downstream server is unavailable.

```text
                ┌────────────────────────────── ARIVE gateway ─────────────────────────────┐
 MCP client ──▶ │ stdio transport → namespaced router → compression middleware → result   │
                └───────┬────────────────────────┬────────────────────────────┬────────────┘
                        │                        │                            │
             ┌──────────▼─────────┐   ┌──────────▼─────────┐       ┌──────────▼──────────┐
             │ spawned MCP servers│   │ in-process adapters│       │ composite pipeline  │
             │ think · lsp · dap  │   │ search · mem       │       │ arive_reasoned_*    │
             │ (optional overrides│   │ context            │       │                     │
             │  for search/mem)   │   │                    │       │                     │
             └────────────────────┘   └────────────────────┘       └─────────────────────┘
```

## Namespaces

Every exposed tool carries a strict prefix, so a server can never collide with another namespace.

| Prefix | Backing implementation | Tools |
| --- | --- | --- |
| `think_*` | `@modelcontextprotocol/server-sequential-thinking`, spawned | dynamic (reasoning steps, backtracking) |
| `lsp_*` | `agent-lsp`, spawned | dynamic (language-server diagnostics and speculation) |
| `dap_*` | `dap-mcp`, spawned | dynamic (debugger operations) |
| `search_*` | **in-process** ripgrep adapter | `search_query`, `search_files` |
| `mem_*` | **in-process** SQLite spatial memory | `mem_remember`, `mem_recall`, `mem_forget`, `mem_stats` |
| `context_*` | **in-process** reversible compressor | `context_compress`, `context_retrieve`, `context_stats` |

Several upstream projects in this lineage are libraries or rulesets rather than installable MCP servers. Spawning a command that does not exist would be worse than useless, so those capabilities are implemented locally with the same semantics (reversible compression, ripgrep search, spatial memory). The three real MCP packages are spawned over stdio and their full tool surface is aggregated.

Local adapters win name collisions. Everything else from a downstream server is exposed as `<namespace>_<sanitized tool name>`, with routing back to the original tool name preserved.

## Composite pipeline

| Tool | What it does |
| --- | --- |
| `arive_reasoned_debug` | Runs sequential-thinking steps, then launches a DAP session with breakpoints, stack, and variables when a debugger and `program` are available, and stores findings in memory. |

The composite returns a `steps` array with `ok`, `skipped`, or `failed` per step. A missing capability is reported as `skipped` with a reason — it is never silently fabricated.

`arive_status` reports namespace tool counts, downstream connection state, the memory database path, and compression store usage.

> Worktree-based automation, the persistent REPL kernel, and the Ponytail ruleset namespace are intentionally not part of this build.

## Reversible context compression

All tool results except `context_retrieve` are inspected. When a text block exceeds `thresholdTokens` (approximate: 4 chars per token, default 2000), it is replaced by an envelope:

```json
{
  "_arive_compressed": true,
  "ref": "ctx:4f1c…",
  "originalChars": 48210,
  "preview": "…",
  "hint": "Call context_retrieve with {\"ref\":\"ctx:4f1c…\"} to recover it."
}
```

The original is retained losslessly in an LRU (default 500 entries) and optionally spilled to disk so refs survive restarts. Non-text blocks (images, audio, resources) are never touched. Set `compression.storeDir` to enable persistence.

## Run

From a local checkout:

```bash
bun install
bun run start                 # or: bun run src/index.ts
bun run start -- --config ./arive.config.json --verbose
```

Directly from GitHub, with no clone:

```bash
bun x --silent github:sixtysixx/ARIVE
```

Bun downloads the repository into its package cache and runs the `arive` bin, installing production dependencies on first launch. The command reads `arive.config.json` and writes state relative to the **current working directory**, so each project keeps its own configuration and memory.

Requirements: Bun ≥ 1.1 and ripgrep (`rg`) on `PATH`. `git` is only needed if a downstream server is installed from a GitHub URL.

> The GitHub link serves the repository's default branch. Changes in your working tree become available through it only after they are committed and pushed.

## Configuration

Configuration is optional. Defaults live in `src/core/config.ts`: three spawned servers (`think`, `lsp`, `dap`) enabled, three local adapters active (`search`, `mem`, `context`). Override precedence:

1. `--config <path>`
2. `$ARIVE_CONFIG`
3. `./arive.config.json`
4. built-in defaults

Copy [`arive.config.example.json`](arive.config.example.json) to `arive.config.json` to customize. Downstream entries merge by `namespace`, so you only specify what changes.

Environment variables:

| Variable | Effect |
| --- | --- |
| `ARIVE_CONFIG` | Config file path. |
| `ARIVE_ENABLE` / `ARIVE_DISABLE` | Comma-separated namespace allow/deny lists. |
| `ARIVE_COMPRESS` | `0` disables compression entirely. |
| `ARIVE_COMPRESS_THRESHOLD` | Token threshold for compression. |
| `ARIVE_MEMORY_DB` | SQLite memory path (default `.arive/memory.db`). |
| `ARIVE_SEARCH_MAX_RESULTS` | Default ripgrep result cap. |
| `ARIVE_LOG` | `error`, `warn`, `info`, or `debug` (stderr only). |

Disable a downstream to use its local adapter:

```json
{ "downstreams": [{ "namespace": "search", "enabled": false }] }
```

Enable the real ripgrep server instead:

```json
{ "downstreams": [{ "namespace": "search", "enabled": true }] }
```

## Client configuration

Claude Desktop / any `mcpServers` client, launched from GitHub:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["x", "--silent", "github:sixtysixx/ARIVE"],
      "env": { "ARIVE_LOG": "info" }
    }
  }
}
```

Using `bun` with the `x` subcommand (rather than `bunx` directly) keeps the same configuration working on Windows, where the `bunx` shim is a `.cmd` file that MCP clients may not resolve.

For a local checkout instead, point at the entry file:

```json
{
  "mcpServers": {
    "arive": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/ARIVE/src/index.ts"],
      "env": { "ARIVE_LOG": "info" }
    }
  }
}
```

A ready-to-paste GitHub-based file is included as [`claude_desktop_config.json`](claude_desktop_config.json).

## Docker

```bash
docker build -t arive .
docker run -i --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  arive
```

The image bundles git and ripgrep. Downstream servers are fetched at runtime with `bun x`, so the container needs network access unless you pre-install them. Always pass `-i` and keep stdout clean — it is the MCP transport.

## Tests

```bash
bun test
bun x tsc --noEmit
```

Coverage includes reversible compression and eviction, config merging and validation, namespace routing and collisions, the debug composite in degraded and DAP-enabled modes, memory and search adapters, a real subprocess MCP handshake against a fixture server, and an end-to-end stdio boot that lists tools, routes a namespaced call, compresses an oversized search payload, and retrieves it losslessly.

## Project layout

```text
src/
  index.ts                 # stdio server, namespaced dispatch, compression middleware
  core/
    config.ts              # defaults, merge, env overrides, validation
    registry.ts            # aggregation, prefixing, routing, capability lookup
    mcp-client.ts          # lazy downstream client, timeouts, reconnect
    compressor.ts          # reversible ctx: store and result middleware
    exec.ts                # spawn wrapper for ripgrep
    results.ts, log.ts     # result helpers and stderr logging
  local/
    context.ts search.ts memory.ts index.ts
  pipelines/
    index.ts               # arive_reasoned_debug
tests/                     # unit suites, fixtures, and a stdio end-to-end test
```

## Operational and security notes

- **Downstream failures are contained.** A missing or misconfigured server marks its namespace unavailable; `arive_status` shows the error and the gateway keeps serving.
- **The composite discovers capabilities, not fixed schemas.** It looks for candidate tool names advertised by a namespace. If a server names things differently, the step is skipped with the failure detail — configure a matching server rather than expecting a hard-coded call to work.
- **Compression refs live in server memory** unless `compression.storeDir` is set; a restart without it invalidates old refs.
- **Search results respect `.gitignore`** because ripgrep is invoked with its defaults.

## License

MIT
