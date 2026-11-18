# ARIVE

**A**ggregate · **R**etrieve · **I**ndex · **V**ectorize · **E**nvelope

- **Aggregate** — namespaced tool aggregation across downstream MCP servers (`ToolRegistry`)
- **Retrieve** — `rag_query`, `search_query`, `mem_recall`, `context_retrieve`
- **Index** — `rag_index` (line-ranged chunk store), memory drawers
- **Vectorize** — optional Ollama/OpenAI embeddings, cosine fusion with BM25
- **Envelope** — oversized output replaced by a `ctx:` ref that recovers losslessly
```text
                ┌────────────────────────────── ARIVE gateway ─────────────────────────────┐
 MCP client ──▶ │ stdio transport → namespaced router → compression middleware → result   │
                └───────┬────────────────────────┬────────────────────────────┬────────────┘
                        │                        │                            │
             ┌──────────▼─────────┐   ┌──────────▼─────────┐       ┌──────────▼──────────┐
             │ spawned MCP servers│   │ in-process adapters│       │ composite pipeline  │
             │ think · lsp · dap  │   │ search · mem · rag │       │ arive_reasoned_*    │
             │ (optional overrides│   │ context            │       │                     │
             │ for mem/search/rag)│   │                    │       │                     │
             └────────────────────┘   └────────────────────┘       └─────────────────────┘
```

## Namespaces

Every exposed tool carries a strict prefix, so a server can never collide with another namespace.

| Prefix      | Backing implementation                                      | Tools                                                   |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `think_*`   | `@modelcontextprotocol/server-sequential-thinking`, spawned | dynamic (reasoning steps, backtracking)                 |
| `lsp_*`     | `agent-lsp`, spawned                                        | dynamic (language-server diagnostics and speculation)   |
| `dap_*`     | `dap-mcp`, spawned                                          | dynamic (debugger operations)                           |
| `search_*`  | **in-process** ripgrep adapter                              | `search_query`, `search_files`                          |
| `mem_*`     | **in-process** SQLite spatial memory                        | `mem_remember`, `mem_recall`, `mem_forget`, `mem_stats` |
| `context_*` | **in-process** reversible compressor                        | `context_compress`, `context_retrieve`, `context_stats` |
| `rag_*`     | **in-process** SQLite FTS5 retrieval, optional embeddings   | `rag_index`, `rag_query`, `rag_stats`, `rag_forget`     |

Several upstream projects in this lineage are libraries or rulesets rather than installable MCP servers. Spawning a command that does not exist would be worse than useless, so those capabilities are implemented locally with the same semantics (reversible compression, ripgrep search, spatial memory, hybrid retrieval). The three real MCP packages are spawned over stdio and their full tool surface is aggregated.

Local adapters win name collisions. Everything else from a downstream server is exposed as `<namespace>_<sanitized tool name>`, with routing back to the original tool name preserved.

## Composite pipeline

| Tool                   | What it does                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arive_reasoned_debug` | Runs sequential-thinking steps, then launches a DAP session with breakpoints, stack, and variables when a debugger and `program` are available, and stores findings in memory. |

The composite returns a `steps` array with `ok`, `skipped`, or `failed` per step. A missing capability is reported as `skipped` with a reason — it is never silently fabricated. When the debug session does not launch, the follow-up steps (`dap_breakpoints`, `dap_continue`, `dap_stack`, `dap_variables`) are recorded as `skipped` rather than omitted, and `ok` is `false` for any run where no step succeeded.

`arive_status` reports namespace tool counts, whether each namespace is enabled, downstream connection state and reconnect cooldown, discovery state, the memory database path, and compression store usage. A transport that dies invalidates its routes immediately, so a dead namespace reports `tools: 0` with the failure rather than its last known count.

`mem_remember` is idempotent per (wing, room, content): re-writing the same drawer merges its tags and updates hall/importance. A lowered `memory.maxItems` is enforced when the store opens, not at the next write.

`rag_index` walks a file tree with ripgrep, splits each file into line-ranged chunks, and stores them in SQLite FTS5 (BM25 weighted 4× toward a code-aware identifier column, so `compressPayload` also matches `compress` and `payload`). Indexing is incremental: equal mtime+size is skipped without reading, and an identical SHA-256 only refreshes the timestamp. Binaries, files over `rag.maxFileBytes`, and files with a single line over 4000 characters are skipped; files that disappeared under the indexed root are pruned. Vectors are optional — with `rag.embeddings.provider` set to `ollama` or `openai`, chunk embeddings are added and `rag_query` fuses BM25 with cosine similarity by reciprocal rank; failure of the provider degrades to lexical results and reports `degraded.reason` instead of failing the query, and missing vectors are backfilled by the next `rag_index`. `rag_query` returns `path:line-line` citations and never compresses them.

Downstream discovery runs in the background: the first `tools/list` answers with local adapters after at most one second of waiting, and the gateway emits `notifications/tools/list_changed` when spawned servers finish reporting. A call to a downstream tool waits for discovery before routing, so a client that ignores the notification still works.

> Worktree-based automation, the persistent REPL kernel, and the Ponytail ruleset namespace are intentionally not part of this build.

## Reversible context compression

All tool results except `context_retrieve`, `arive_status`, and the `rag_*` family are inspected. When a text block exceeds `thresholdTokens` (approximate: 4 chars per token, default 2000), it is replaced by an envelope:

```json
{
  "_arive_compressed": true,
  "ref": "ctx:4f1c…",
  "originalChars": 48210,
  "preview": "…",
  "hint": "Call context_retrieve with {\"ref\":\"ctx:4f1c…\"} to recover it."
}
```

The original is retained losslessly in an LRU (default 500 entries) and optionally spilled to disk so refs survive restarts. Non-text blocks (images, audio, resources) are never touched. Set `compression.storeDir` to enable persistence; the disk cache is pruned at startup and hourly, dropping files older than 7 days and then the oldest entries above 256 MiB. Error results (`isError`) are never compressed, so a failure message always reaches the client verbatim.

Gateway-level tools (`arive_reasoned_debug`) follow the same global threshold; only `arive_status` is exempt so health stays readable. A namespace configured with `compress: false` is exempt too, as are the local `context_*` and `rag_*` adapters: compression must never hide the payload or the retrieval answer being asked for. When compression replaces `structuredContent`, the result carries `structuredContentOmitted: true`, which distinguishes "the gateway dropped it" from "the server never sent any".

`context_compress` refuses with an error when compression is disabled by configuration (`compression.enabled=false`, `ARIVE_COMPRESS=0`); pass `force: true` to store the payload anyway.

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

Configuration is optional. Defaults live in `src/core/config.ts`: three spawned servers (`think`, `lsp`, `dap`) enabled, four local adapters active (`search`, `mem`, `context`, `rag`). Override precedence:

1. `--config <path>`
2. `$ARIVE_CONFIG`
3. `./arive.config.json`
4. built-in defaults

A path given through `--config` or `$ARIVE_CONFIG` must exist: a typo fails startup with `Config file not found: …` instead of silently running on defaults. `./arive.config.json` stays optional. A bare `--config`/`-c` with no path is likewise fatal (`[arive] fatal: --config requires a path`, exit 1) instead of starting the gateway on defaults.

Copy [`arive.config.example.json`](arive.config.example.json) to `arive.config.json` to customize. Downstream entries merge by `namespace`, so you only specify what changes.

Environment variables:

| Variable                         | Effect                                                   |
| -------------------------------- | -------------------------------------------------------- |
| `ARIVE_CONFIG`                   | Config file path.                                        |
| `ARIVE_ENABLE` / `ARIVE_DISABLE` | Comma-separated namespace allow/deny lists.              |
| `ARIVE_COMPRESS`                 | `0` disables compression entirely.                       |
| `ARIVE_COMPRESS_THRESHOLD`       | Token threshold for compression.                         |
| `ARIVE_MEMORY_DB`                | SQLite memory path (default `.arive/memory.db`).         |
| `ARIVE_RAG_DB`                   | SQLite retrieval index path (default `.arive/rag.db`).   |
| `ARIVE_SEARCH_MAX_RESULTS`       | Default ripgrep result cap.                              |
| `ARIVE_LOG`                      | `error`, `warn`, `info` (default), `debug`; stderr only. |

Disable a downstream to use its local adapter:

```json
{ "downstreams": [{ "namespace": "search", "enabled": false }] }
```

Enable the real ripgrep server instead:

```json
{ "downstreams": [{ "namespace": "search", "enabled": true }] }
```

Tune the retrieval index — every field is optional, and the default provider is offline:

```json
{
  "rag": {
    "chunkChars": 1200,
    "chunkOverlapChars": 200,
    "maxFiles": 20000,
    "defaultTopK": 8,
    "maxPerFile": 3,
    "embeddings": { "provider": "ollama", "model": "nomic-embed-text" }
  }
}
```

`rag.embeddings.provider` accepts `none` (default), `ollama`, or `openai`. Ollama defaults to `http://127.0.0.1:11434`; the OpenAI-compatible endpoint defaults to `https://api.openai.com/v1` and reads its key from `rag.embeddings.apiKeyEnv` (default `OPENAI_API_KEY`) on every request. Set `baseUrl` to point at any compatible server. Switching models over an existing index requires `rag_index` with `force: true`, otherwise the gateway refuses to mix vectors from two models.

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

Coverage includes reversible compression and eviction, disk-retention pruning, error passthrough, config merging and validation, namespace routing and collisions, staged discovery with a hung downstream, reconnect cooldown, request cancellation, memory recall metadata and LIKE escaping, search truncation reporting, chunking and line-range round-trips, incremental and pruned RAG indexing, hybrid BM25/vector fusion with a failing and a fake HTTP embedding provider, the debug composite in degraded and DAP-enabled modes, a real subprocess MCP handshake against a fixture server, and an end-to-end stdio boot that lists tools, announces late discovery, routes a namespaced call, compresses an oversized search payload, and retrieves it losslessly.

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
    rag/                   # chunker, embeddings, FTS5 store, tools
  pipelines/
    index.ts               # arive_reasoned_debug
tests/                     # unit suites, fixtures, and a stdio end-to-end test
```

## Operational and security notes

- **Downstream failures are contained.** A missing or misconfigured server marks its namespace unavailable; `arive_status` shows the error and the gateway keeps serving. A failed spawn or a crashed child is not retried for 30 seconds (`retryInMs`), so discovery stays cheap; an explicit tool call retries immediately.
- **Timeouts cancel.** `connectTimeoutMs` and `callTimeoutMs` are enforced by the MCP request layer, so a hanging request is aborted instead of lingering.
- **The composite discovers capabilities, not fixed schemas.** It looks for candidate tool names advertised by a namespace. If a server names things differently, the step is skipped with the failure detail — configure a matching server rather than expecting a hard-coded call to work.
- **Compression refs live in server memory** unless `compression.storeDir` is set; a restart without it invalidates old refs.
- **Search results respect `.gitignore`** because ripgrep is invoked with its defaults.

## License

MIT
