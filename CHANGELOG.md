# Changelog

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
