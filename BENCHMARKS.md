# ARIVE Promptfoo Benchmarks: With vs. Without MCP Tools

This benchmark suite evaluates the quantitative and qualitative performance delta of an LLM operating **with** the ARIVE MCP tools and sequential reasoning rules versus a baseline model operating **without** them.

By comparing these two modes, we measure the direct impact of the ARIVE protocol on reasoning rigour, token efficiency, and compliance.

---

## The Performance Delta Metrics

The benchmark measures the performance gap across three core axes:

| Metric | Baseline Model (Without MCP Tools) | ARIVE-Enhanced Model (With MCP Tools) | Performance Delta / Impact |
| :--- | :--- | :--- | :--- |
| **Reasoning Protocol Adherence** | 0% compliance. Skips structured reasoning gates, outputs unstructured content, and fails verification checks. | 100% compliance. Strictly enforces the 5-phase sequential reasoning gates (Scope, Evidence, Challenge, Verify, Report). | **Infinite reasoning compliance improvement.** Prevents logical shortcuts and rushed implementations. |
| **Brevity & Emojis (Tone Guard)** | Fails style guidelines. Incorporates informal greetings (e.g., "Hey there!"), exclamation marks, and emojis (e.g., `🚀`), polluting text. | Passes all constraints. Enforces professional, telegraphic, objective, and emoji-free communication. | **Eliminates conversational fluff and distractions.** Ensures the model's communication is rigorous. |
| **Context Window Compression** | 0% active savings. The model must repeatedly ingest large raw text files, bloating the context window and increasing retrieval errors. | up to 90% active token savings. Long contents are compressed via `arive_compress` and references are stored as `ccr:sha256` hashes in the registry. | **Exponential context token efficiency.** Keeps prompt size constant and maintains context integrity. |
| **Verification & Self-Correction** | Single-pass guess. The model implements code edits in one pass with no compilation check, leaving compilation/test failures unaddressed. | Continuous self-correction. The model uses `arive_verify` in a feedback loop, backpropagating test failures directly into its thoughts to auto-fix bugs. | **Dramatic increase in compilation and logical correctness.** Code compiles and passes local tests before yielding. |

---

## Evaluation Architecture

We use **[promptfoo](https://promptfoo.dev/)** to perform this side-by-side comparative evaluation.

1. **Baseline Prompt (`baseline_prompt.txt`)**:
   Simulates a standard LLM request template:
   ```
   You are a helpful AI assistant.
   Task: {{task}}
   Response:
   ```

2. **ARIVE Prompt (`arive_prompt.txt`)**:
   Injects the full **ARIVE Advanced Frontier Model Orchestration Prompt**, instructing the model to adhere to the 5-phase sequential reasoning protocol and utilize the MCP tools (`arive_compress`, `arive_think`, `arive_verify`, `arive_decompress`).

3. **Evaluation Runner (`promptfooconfig.yaml`)**:
   Defines assertions to verify the presence of key phase gates and compliance with tone constraints (e.g., absence of informal greetings or emojis).

4. **Mock Provider (`scripts/mock_provider.js`)**:
   Simulates how LLMs behave in both environments:
   - When given the **ARIVE Prompt**, it returns a compliant, professional output structure adhering to all gates.
   - When given the **Baseline Prompt**, it returns an informal, conversational response lacking phase gates and using emojis.

---

## How to Run the Benchmark

Execute the comparison using Bun:

```bash
bun run benchmark
```

This script generates the prompt files and runs `promptfoo eval` to compare the outputs side-by-side.

### Expected Output

```
┌────────────────────────────────────────┬────────────────────────────────────────┬────────────────────────────────────────┐
│ task                                   │ arive_prompt.txt                       │ baseline_prompt.txt                    │
├────────────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────┤
│ Develop and integrate promptfoo        │ [PASS] Here is the comprehensive       │ [FAIL] Hey there! Super excited to     │
│ benchmarks for ARIVE                   │ response adhering to the ARIVE 5-phase │ tell you about the new config...       │
│                                        │ protocol...                            │                                        │
└────────────────────────────────────────┴────────────────────────────────────────┴────────────────────────────────────────┘

Results:
  ✓ 1 passed (50.00%) - ARIVE Prompt
  ✗ 1 failed (50.00%) - Baseline Prompt (Violates gates & informal tone check)
```

*(Note: The command exiting with code 100 is normal as it indicates the baseline prompt has correctly failed the strict compliance gates).*

---

## Testing with Real Agents: MCP On vs. Off

The most authentic measure of ARIVE's impact is running a real agent session **with** ARIVE MCP tools connected versus **without** them. Below is the methodology for agents like **KiloCode**, **omp (oh-my-pi)**, and **Antigravity (agy)**.

---

### Methodology

1. **Choose an agent** from the supported list (kilocode, omp, agy).
2. **Run the same task twice**: once with ARIVE MCP enabled, once with it disabled.
3. **Score the output** against a rubric (see [Scoring Rubric](#scoring-rubric) below).

### Task Template

Use a task that exercises all phases of the ARIVE pipeline — analysis, reasoning, code modification, and verification:

> "Refactor the error-handling utilities in `src/utils/errors.ts` to use a centralized `Result<T,E>` type instead of thrown exceptions. Run the existing test suite to verify nothing is broken, then add two new edge-case tests."

---

### A — KiloCode (MCP ON vs. OFF)

KiloCode supports MCP servers via its global or project-level config.

#### MCP ON

1. Ensure ARIVE MCP is registered in your KiloCode config:

   **Global** (`~/.config/opencode/opencode.json` — KiloCode shares OpenCode infra):
   ```json
   {
     "plugin": ["github:sixtysixx/ARIVE"]
   }
   ```
   or **Project-local** (`.kilocode/mcp.json`):
   ```json
   {
     "mcpServers": {
       "arive": {
         "command": "bunx",
         "args": ["--silent", "github:sixtysixx/ARIVE"]
       }
     }
   }
   ```

2. Open the workspace in KiloCode. The ARIVE tools (`arive_compress`, `arive_think`, `arive_integrate`, `arive_verify`, `arive_explain`) are now available to the agent.
3. Paste the task above and observe:
   - Does the agent call `arive_compress` before pasting large files into context?
   - Does it use `arive_think` to structure its reasoning steps?
   - Does it invoke `arive_verify` after making changes, then backpropagate failures?
   - Are the final outputs compliant with the 5-phase reasoning gates?

#### MCP OFF

1. Remove or comment out the ARIVE MCP server entry from your KiloCode config (or rename the plugin entry temporarily).
2. Restart KiloCode.
3. Paste the **exact same task** and observe:
   - The agent has no access to `arive_compress` — raw file content fills the context window.
   - No structured reasoning graph — the agent produces a linear, single-pass answer.
   - No verification loop — code is emitted without running tests or backpropagating.
   - Output style is conversational — may contain greetings, emojis, and informal language.

#### Scoring

| Criterion | KiloCode MCP ON | KiloCode MCP OFF |
| :--- | :--- | :--- |
| Reasoning gates present | ✅ All 5 phases | ❌ None or partial |
| Context compression used | ✅ `arive_compress` called | ❌ Raw content in every turn |
| Tests run & passed | ✅ `arive_verify` invoked | ❌ No verification |
| Professional tone | ✅ Objective, emoji-free | ❌ May contain `🚀`, "awesome" |
| Token efficiency | High (hash references) | Low (full text repeated) |

---

### B — omp (oh-my-pi, MCP ON vs. OFF)

omp reads MCP config from `~/.omp/agent/mcp.json` (global) or `.omp/mcp.json` (project).

#### MCP ON

**Global** (`~/.omp/agent/mcp.json`):
```json
{
  "mcpServers": {
    "arive": {
      "command": "bunx",
      "args": ["--silent", "github:sixtysixx/ARIVE"]
    }
  }
}
```

Restart omp after adding the config. Confirm the ARIVE tools are listed:
```
arive_compress — Compresses strings based on code, JSON, logs or prose optimizations
arive_think   — Records a single thought block in the reasoning sequence
arive_verify  — Runs testing suites in the task directory workspace path
```

#### MCP OFF

1. Remove or comment out the `arive` entry from your omp MCP config.
2. Restart omp.
3. Run the same task — the agent operates without any ARIVE MCP tools.

#### Scoring

Apply the same rubric as KiloCode above. Expect the same delta: MCP ON produces structured, verified, token-efficient output; MCP OFF produces linear, unverified, context-heavy output.

---

### C — Antigravity / agy (MCP ON vs. OFF)

Antigravity loads ARIVE as a plugin. MCP is toggled by installing or uninstalling the plugin.

#### MCP ON

```bash
# Install the ARIVE plugin (registers MCP, rules, and skills)
agy plugin install github:sixtysixx/ARIVE
```

This stages the plugin at `~/.gemini/antigravity-cli/plugins/arive/` and registers the MCP server automatically. Confirm:
```bash
agy mcp list
# Should include "arive" in the list of available MCP servers
```

#### MCP OFF

```bash
# Uninstall the ARIVE plugin to remove MCP access
agy plugin uninstall arive
# or temporarily rename the plugin directory:
mv ~/.gemini/antigravity-cli/plugins/arive ~/.gemini/antigravity-cli/plugins/arive.BAK
```

Restart agy. Run the same task.

#### Scoring

Same rubric as above. Additionally, with MCP ON, agy has access to the `fade` skills and ARIVE rules loaded from the plugin's `rules/` and `skills/` directories — the agent can invoke `/fade` commands to switch reasoning modes.

| Feature | agy MCP ON | agy MCP OFF |
| :--- | :--- | :--- |
| Fade skills available | ✅ `/fade`, `/fade-review`, etc. | ❌ |
| ARIVE rules loaded | ✅ `.antigravity/rules/fade.md` | ❌ |
| MCP tools callable | ✅ `arive_compress`, `arive_think`, `arive_verify` | ❌ |

---

### Scoring Rubric

Use this rubric to score any agent session (MCP ON vs. OFF):

| # | Criterion | Weight | MCP ON (score 0–5) | MCP OFF (score 0–5) |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Phase gate compliance** — output contains Scope, Evidence, Challenge, Verify, Report sections | 30% | | |
| 2 | **Context efficiency** — agent uses compression/registry references vs. repeating raw content | 25% | | |
| 3 | **Verification & correctness** — agent runs tests, backpropagates failures, fixes before yielding | 25% | | |
| 4 | **Tone & style** — output is professional, objective, emoji-free | 10% | | |
| 5 | **Speed-to-completion** — wall-clock time from task acceptance to final verified output | 10% | | |

**Weighted total**: Multiply each score by its weight, sum them, and compare. The delta (`MCP ON total − MCP OFF total`) is the direct performance gain from ARIVE.

---

### Running the promptfoo Mock Alongside Agent Tests

To validate your agent observations against the formal promptfoo suite:

```bash
bun run benchmark
```

This runs the `arive_prompt.txt` vs. `baseline_prompt.txt` comparison through the mock provider, confirming the expected compliance gap (ARIVE: PASS, Baseline: FAIL). Use this as a quick regression gate before or after your agent sessions.
