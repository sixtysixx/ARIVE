# Changelog

## Unreleased

Guard hooks at the tool boundary, one catalogue for namespace knowledge, and four hot-path fixes. No wire-protocol change: the gateway gains one tool (`arive_guard`), one config block (`hooks`), and `arive_status.hooks`.

### Added

- **Guard hooks.** `hooks.guards` declares rules with an `id`, a `scope` (`args`/`text`/`both`), optional `tool` and `condition` regular expressions, an `action` (`block`/`warn`), and the `guidance` a caller must follow instead. The gateway never sees the model's token stream, so enforcement happens at the boundary it owns: a `tools/call` whose arguments match a blocking rule returns `isError` with `executed: false`, the rule, its guidance, and a `<system-reminder>` block, and the tool never runs. Pipeline order is fixed — guard, dispatch, compress, annotate — so a `ctx:` envelope can never swallow the guidance. Rules are compiled once at startup and a malformed rule fails startup rather than failing open at call time; arrays replace defaults instead of merging item by item.
- **`arive_guard`.** Evaluates the same compiled rules against generated text and returns `blocked`/`abort` with a `reminder`, so a client can validate output before committing it; `includeRules: true` returns the rule set. The configured rules are also rendered into the server `instructions`, so no client carries its own copy.
- **Doc hooks.** `hooks.docs` appends `<arive-doc>` snippets to the results of tools selected by a `tool` pattern, which puts project conventions where the call happens.
- **`astCondition`.** `{ pattern, lang, selector?, strictness? }` matches structure with ast-grep instead of bytes, against each string argument or the supplied text. A missing `sg`, an unusable pattern, or a run past `astTimeoutMs` is reported in `degraded` and counted as no match — never as a silent pass; `hooks.onAstError: "block"` turns an unevaluable rule into a blocked call. Identical patterns run `sg` once per check.

### Changed

- **One namespace catalogue.** `NAMESPACE_INFO` now owns each prefix's summary and compression policy; the server `instructions`, the compression decisions (`ToolRegistry.isCompressible`), and the README table all derive from it instead of from four hand-kept copies. `tests/catalog.test.ts` compares the README table against `NAMESPACES`, so the duplication cannot return unnoticed.
- **Compression exemptions are declared per tool.** `arive_status` and `arive_guard` carry `compressible: false`, and `context_*`/`rag_*` are exempt by namespace policy rather than by a name list in the entry point.
- **`arive_status` reports `hooks`** counters: guards, docs, checks, blocked, warned, astChecks, astErrors.

### Performance

- **`search_query` and `search_files` stream ripgrep.** `runCommand` gained a line callback that kills the child when the caller has enough, so a capped query no longer buffers or parses the whole repository. A stopped child is not mistaken for an unrunnable binary.
- **Compression spills leave the request path.** Disk writes are queued in submission order and pruned after the write; `flush()` runs during shutdown so a ref handed to a client survives the restart it implies. The startup and periodic prunes share one selection rule.
- **`rag_query` decodes vectors zero-copy** when the blob is 4-byte aligned and rejects dimension mismatches before touching their bytes; `rag_index` yields to the event loop every 25 files, so other in-flight requests run during a large index.

### Tests

- New `tests/catalog.test.ts` (catalogue/README drift, compression policy), `tests/exec.test.ts` (line callback, early kill, byte cap), `tests/rag-vectors.test.ts` (aligned and offset round trips, no aliasing), `tests/hooks.test.ts` (scope separation, tool filter, warn annotation, doc injection, rule validation, blocked envelope), and `tests/hooks.ast.test.ts` (real `sg` when spawnable, skipped otherwise; degrade behaviour with injected runners).
- `tests/gateway.e2e.test.ts` boots the real server and asserts a blocked `search_query`, `arive_guard`'s abort payload, and `arive_guard` in the tool list; `tests/search.test.ts` and `tests/compressor.test.ts` gained cap and spill-flush coverage.

## 2.2.0 — 2026-11-18

Adds a seventh namespace. `rag_*` is a local hybrid-retrieval adapter — incremental line-ranged indexing over a file tree, BM25 ranking in SQLite FTS5, and optional vector fusion — so the gateway can answer "where is this implemented?" without a network round trip or an API key.

### Added

- **`rag_*` namespace (in-process).** `rag_index` walks a tree with ripgrep and stores line-ranged chunks in SQLite FTS5. Indexing is incremental by mtime+size and then SHA-256, skips binaries, oversized files, and files with a single line over 4000 characters, prunes files that disappeared under the indexed root, and refuses to prune when the enumeration was capped (`truncated`), because a truncated list looks like a directory full of deletions.
- **`rag_query` fuses lexical and vector rank.** BM25 is weighted 4× toward a code-aware identifier column (`compressPayload` indexes as `compresspayload`, `compress`, `payload`), so identifiers match without camelCase guessing. With `rag.embeddings.provider` set to `ollama` or `openai`, chunk embeddings are stored alongside the chunks and fused with reciprocal rank; results carry `path:line-line` citations, a per-file cap, and a character budget.
- **Degradation instead of failure.** An unreachable provider, a missing API key, or a model switch without `force: true` leaves lexical results intact and reports `degraded.reason`. Missing vectors are backfilled by the next `rag_index`. The default provider is `none`, so no network call happens unless configured.
- **Config surface.** `rag.{dbPath,chunkChars,chunkOverlapChars,maxFileBytes,maxFiles,defaultTopK,maxTopK,maxPerFile,maxVectorScan}` and `rag.embeddings.{provider,model,baseUrl,apiKeyEnv,batchSize,timeoutMs}` merge over defaults and are validated; `$ARIVE_RAG_DB` overrides the index path. A disabled `rag` downstream slot is reserved for the official Qdrant server (`uvx mcp-server-qdrant`) and loses name collisions to the local adapter.

### Changed

- **`arive_status` reports `local.ragDb`**, and its note lists the `rag` adapter.
- **Retrieval results are never compressed.** The `context_*` exemption now covers `rag_*` too: an envelope would hide the citations and chunk text the caller asked for. `rag_index` and `rag_stats` summaries stay readable for the same reason.

## 2.1.0 — 2026-11-12

Reliability and correctness pass over the gateway. The local tool surface, downstream failure costs, memory/compression/search semantics, and configuration validation changed; the wire protocol only gained one advertised capability.

The minor bump reflects three observable behavior changes rather than new tools: `mem_remember` unions tags on re-write instead of replacing them, gateway-level `arive_*` results are now subject to the compression threshold, and a `close()` that races a startup handshake reports `Namespace "…" was closed during startup` instead of silently connecting. Everything else is a fix.

### Changed

- **Discovery is background work.** `ToolRegistry` installs local adapters synchronously, waits at most one second on the first `tools/list`, and then serves the route table without touching any downstream. The gateway advertises `tools.listChanged` and emits `notifications/tools/list_changed` when the aggregated list actually changes. A downstream call still waits for discovery before routing, and a namespace that failed discovery is retried once when a tool in it is called explicitly.
- **Downstream listing no longer re-spawns.** Tools reported during discovery are cached on the route, so `tools/list` costs no downstream request. The old `namespaceFromError` string matching is gone; failed results are attributed by array index.
- **Reconnect cooldown.** A failed spawn or a closed transport parks the downstream for 30 seconds (`RETRY_COOLDOWN_MS`), exposed as `status().retryInMs` and shown by `arive_status`. Explicit tool calls bypass the cooldown.
- **Timeouts are enforced by the MCP request layer.** `connectTimeoutMs` and `callTimeoutMs` are passed as `RequestOptions.timeout` instead of racing an abandoned promise, so a hanging request is cancelled. Timeout errors read `<namespace> tools/list timed out after …` and `<namespace>/<tool> timed out after …`. The hand-rolled `withTimeout` helper is deleted.
- **`context_compress` lost its `contentType` argument.** It was a namespace hint that let a caller misfile a payload; the tool now always stores under `context`.
- **`arive_status` reports `discovery` state** (`discovered`, `discovering`) alongside namespace counts.
- **Search results report truncation honestly.** Hitting `maxResults` is detected before dropping a match, and both adapters return `truncated`. A timeout is reported as a timeout instead of a failed spawn.

### Fixed

- **`close()` is authoritative.** `DownstreamClient.close()` bumps a generation counter, and a handshake that completes afterwards closes its own client instead of installing it, so a shutdown can no longer be overtaken by an in-flight `connect()`. It also clears `lastError`/`retryAt`, so a deliberate close reports `connected: false` with no phantom failure or cooldown.
- **A dead downstream no longer keeps stale routes.** A closed transport now notifies `ToolRegistry`, which marks discovery stale and re-lists: the cooldown makes the dead namespace fail fast, its routes are dropped, `discoveryErrors` gains the message, and `tools/list_changed` fires. `namespaceSummary()` gained an `enabled` flag so a disabled namespace stops looking like a healthy empty one.
- **`ctx:` refs are validated.** `ContextCompressor.retrieve` accepts only `ctx:` plus 32 hex characters, so a ref such as `ctx:../../secret` can no longer steer the disk read. The unread `namespace` field on a compression entry is gone; refs are now an id, not a path fragment.
- **The debug pipeline's ledger is honest.** When the launch fails or no DAP tool exists, `dap_breakpoints`/`dap_continue`/`dap_stack`/`dap_variables` are recorded as `skipped` instead of vanishing, a missing capability is recorded as `skipped` rather than omitted, and `ok` is no longer `true` for a run in which nothing succeeded.
- **Capability lookup follows the caller's preference order.** `ToolRegistry.findTool` iterates candidates before routes, so `["launch", "attach"]` resolves to `launch` even when the downstream lists `attach` first. The old unordered `includes` also matched by iteration order.
- **A memory drawer keeps its tags.** `mem_remember` merged nothing, so re-writing a drawer replaced its tags. It now unions them with the stored set, and its description says so.
- **A lowered `memory.maxItems` takes effect at open.** The store prunes in its constructor instead of waiting for the next write.
- **Recall returns what it wrote.** `mem_recall` used to patch `access_count`/`last_accessed` onto a pre-update snapshot; it now uses `UPDATE … RETURNING *` and reorders the rows to the original ranking.
- **Compression is a threshold, not a name check.** Gateway-level tools (`arive_reasoned_debug`) were exempt from compression because their prefix is not a namespace; they now follow the global threshold, and `arive_status` is exempt explicitly instead. Compression marks results with `structuredContentOmitted: true` when it drops structured content, and `context_compress` reports disabled compression as an error instead of blaming the payload size.
- **Search separates "killed" from "missing".** `ExecResult` carries `signal`; a ripgrep killed by a signal reports `ripgrep was killed by <signal>` instead of "install ripgrep", and a byte-capped run now contributes to `truncated`.
- **Shutdown drains in-flight calls.** The gateway refuses new calls once shutdown starts, waits up to five seconds for running ones, and only then closes downstreams and the memory database.
- **A bare `--config` is fatal.** `--config`/`-c` with no following path exits 1 with `--config requires a path` instead of ignoring the flag and starting on defaults.
- **Error results are no longer compressed.** An `isError` result used to be replaced by a `ctx:` envelope, hiding the failure text behind a reference. `ContextCompressor.apply` returns error results verbatim.
- **The disk compression store is bounded.** Files older than 7 days are pruned, then the oldest entries above 256 MiB, at startup and at most hourly. Each prune is best-effort and logs instead of throwing.
- **Recall updates access metadata.** `mem_recall` bumped nothing, so `ORDER BY last_accessed` was effectively `ORDER BY created_at`. Recalled drawers now get a new `last_accessed` and an incremented `access_count`, and the returned rows show the incremented values.
- **`mem_recall` normalizes filters like `mem_remember`.** Remembering with `wing: "My Wing"` and recalling with the same string previously matched nothing, because only writes were slugged.
- **LIKE wildcards in a query are literal.** `mem_recall({ query: "100%" })` matched every drawer; `%` and `_` are now escaped.
- **A missing explicit config file is an error.** `--config <path>` and `$ARIVE_CONFIG` pointing at a nonexistent file now fail with `Config file not found: …` instead of silently running on defaults. `./arive.config.json` stays optional.
- **Numeric settings are validated.** `compression.maxEntries`, `compression.previewChars`, `memory.maxItems`, and `search.maxResults` reject values that cannot work (`0`, negatives, non-integers) instead of degrading at runtime.
- **A child that dies mid-`rg` no longer risks an unhandled stdin error.** `runCommand` attaches a no-op stdin error listener.

### Tests

- New `tests/timeout.test.ts` (slow fixture, cooldown), `tests/search.test.ts` (truncation), `tests/context.test.ts` (envelope namespace, no `contentType`). `tests/registry.test.ts` covers a hung downstream, change notifications, namespace-less local tools, and callee-triggered rediscovery. `tests/gateway.e2e.test.ts` asserts late discovery and the `tools/list_changed` counter. `tests/memory.test.ts` covers access counts, wing normalization, and wildcard escaping. `tests/compressor.test.ts` covers error passthrough and disk pruning. `tests/config.test.ts` covers required paths and numeric validation.
- New coverage for the state-machine fixes: `tests/downstream.test.ts` closes a client mid-handshake and asserts it stays closed without a phantom error; `tests/registry.test.ts` covers close-triggered route invalidation, the `enabled` flag, and capability preference order; `tests/compressor.test.ts` rejects unissued refs; `tests/pipelines.test.ts` covers a failed launch and a run with no successes; `tests/memory.test.ts` covers tag merging and startup pruning; `tests/search.test.ts` separates a killed child from a missing binary; `tests/gateway.e2e.test.ts` compresses composite output while leaving `arive_status` readable.

## 2.0.0 — 2026-10-26

Version bump only; behavior is unchanged apart from one reporting fix. The tool surface made incompatible by `5575c50` is now reflected in the number clients see.

### Changed

- `version` raised from `1.0.0` to `2.0.0`. Seven `arive_*` tools (`arive_compress`, `arive_decompress`, `arive_explain`, `arive_memory_bank`, `arive_think`, `arive_verify`, `arive_workspace`) were removed in `5575c50` with no major bump, so a cached `1.0.0` and a current build answered `tools/list` differently under the same version.
- The reported version now has one source, `src/core/version.ts`. Previously `src/index.ts` hard-coded `1.0.0` while `src/core/config.ts` defaulted separately, so the two could drift. `tests/version.test.ts` asserts that `VERSION`, `package.json`, the default config, and `arive.config.example.json` all agree.

### Fixed

- `server.version` from a config file or `ARIVE_CONFIG` was parsed and validated but never used: the MCP `initialize` handshake and the startup log both read the hard-coded constant. Both now read `config.server.version`, so a configured version is actually reported. Default output is unchanged: `arive 2.0.0 ready`.

## 1.0.0 — 2026-10-24

Retroactive record for commit `5575c50`, which landed on `master` with an empty body. Everything below is reconstructed from that diff; it adds no behavior. It shipped as `1.0.0`, and the published tool surface changed incompatibly under that number.

### Changed

- The server is now a **namespaced MCP gateway**: one stdio process that spawns `think` (`@modelcontextprotocol/server-sequential-thinking`), `lsp` (`agent-lsp`), and `dap` (`dap-mcp`), serves `search`, `mem`, and `context` from in-process adapters, and exposes everything as `<namespace>_<tool>` with local adapters winning name collisions.
- `src/index.ts` reduced from 822 to 146 changed lines: namespaced routing, compression middleware, and `arive_status`.
- Configuration moved into `src/core/config.ts`: defaults, deep merge by namespace, `ARIVE_*` env overrides, and validation. `arive.config.example.json` mirrors the defaults.
- Reversible compression is now `context_compress` / `context_retrieve` / `context_stats` with `ctx:` refs, replacing the `ccr:` registry and its hash verification path.
- `@modelcontextprotocol/sdk` raised to `^1.32.2`; `typescript` moved from dependencies to devDependencies; `promptfoo` and `bun-types` versions bumped.
- `tsc` script changed from `tsc` to `tsc --noEmit`.

### Removed — in-house ARIVE five-phase engine

The Phase A/R/I/V/E implementations were deleted and are not stubs or placeholders:

| Removed                                                                                   | Was                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/analyze/{content_router,smart_crusher,ast_compressor,cache_aligner,ccr_registry}.ts` | Content classification, JSON crushing, AST trimming, cache alignment, `ccr:` store                                           |
| `src/reason/{sequential_engine,memory_bank}.ts`                                           | Graph-based backtracking reasoning, hash-chained memory bank                                                                 |
| `src/integrate/{workspace,hook_manager}.ts`                                               | `.arive-tasks/` worktrees, `pre-*`/`post-*` hooks                                                                            |
| `src/verify/{tdd_runner,validator}.ts`                                                    | TDD loop with failure backpropagation                                                                                        |
| `src/explain/fade_formatter.ts`                                                           | `lite`/`full`/`ultra` telegraphic text formatter                                                                             |
| `src/mcp/{compact.ts,tools/*}`                                                            | `arive_compress`, `arive_decompress`, `arive_explain`, `arive_memory_bank`, `arive_think`, `arive_verify`, `arive_workspace` |
| `src/lifecycle.ts`                                                                        | Server lifecycle wiring for the above                                                                                        |

README states the exclusion explicitly: worktree automation, the persistent REPL kernel, and the Ponytail ruleset namespace are intentionally not part of this build. `arive_status` and `arive_reasoned_debug` are the only remaining `arive_*` tools.

### Removed — repository tooling

- **Benchmarks**: `BENCHMARKS.md`, `promptfooconfig.yaml`, `scripts/prepare_prompt.ts`, `scripts/benchmark_arive_toolset.ts`, `scripts/benchmark_arive_prompts_multi.ts`, `scripts/mock_provider.js`, and the `benchmark*` scripts. The old README carried a with/without results table (including an "infinite improvement" row) that no longer has a harness behind it; the table went with the harness.
- **Rule generation**: `scripts/sync_rules.ts`, `rules/fade.md`, `.fallowrc.json`, the `rules:sync` / `rules:check` scripts, and the CI `Rule Sync` job.
- **Per-editor mirrors**: `.agents/rules/`, `.antigravity/`, `.claudecode/`, `.clinerules`, `.cline/`, `.cursor/`, `.kilocode*`, `.kiro/`, `.omp/`, `.openclaw/` (including the fable/fade skill mirrors), `.opencode/`, `.roo/`, `.windsurf/`, `skills/`, `mcp_config.json`, `opencode.json`, `opencode.mjs`, `plugin.json`. `.agents/mcp.json` and the renamed `claude_desktop_config.json` remain as client examples.
- **Hooks**: `.arive/hooks/{pre,post}-{reason,verify}.ts`. `.arive/` is now ignored wholesale as gateway runtime state.

### Added

- `src/core/{compressor,config,exec,log,mcp-client,registry,results}.ts` — compression middleware, config, ripgrep spawn wrapper, stderr logging, lazy downstream client with timeouts and reconnect, route table, result helpers.
- `src/local/{context,memory,search,index}.ts` — in-process context store, SQLite spatial memory, ripgrep search.
- `src/pipelines/index.ts` — `arive_reasoned_debug`, which reports per-step `ok` / `skipped` / `failed` instead of fabricating missing capabilities.
- Test suites: `compressor`, `config`, `downstream`, `memory`, `pipelines`, `registry`, and a stdio `gateway.e2e` (37 tests over 7 files, including `tests/fixtures/fake_downstream.ts`). The suites deleted alongside their modules were `workspace_flow`, `memory_bank`, `index`, `ccr_registry`, `analyze_pipeline`, `hook_manager`, `sequential_engine`, `sequential_engine_sqlite`, `integrate`, `compact`, `fable_integration`, `verify`, `fade_formatter`.
- CI installs `ripgrep` before running the suite, because the `search` adapter shells out to it.

### Verification

At `5575c50`: `bun run tsc` clean, `bun test` 37 pass / 0 fail, `bun run src/index.ts` starts and reports `{"downstreams":["think","lsp","dap"],"compression":"2000 tokens"}`.
