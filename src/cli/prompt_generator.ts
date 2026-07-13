import * as fs from "fs";
import * as path from "path";

interface ProjectInfo {
  name: string;
  languages: string[];
  isArive: boolean;
}

/**
 * Dynamically detects project information based on current working directory.
 */
function detectProjectInfo(): ProjectInfo {
  const cwd = process.cwd();
  let name = path.basename(cwd);
  const languages: string[] = [];
  let isArive = false;

  // Try parsing package.json first
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.name) {
        name = pkg.name;
      }
      if (pkg.name === "arive-mcp") {
        isArive = true;
      }
    } catch {
      // Ignore JSON parse errors and proceed
    }
  }

  // Double check ARIVE source directory structure
  if (fs.existsSync(path.join(cwd, "src", "reason", "sequential_engine.ts"))) {
    isArive = true;
  }

  // Scan current directory for common languages
  try {
    const files = fs.readdirSync(cwd);
    const hasExt = (ext: string) => files.some((f) => f.endsWith(ext));

    if (hasExt(".ts") || hasExt(".tsx") || fs.existsSync(path.join(cwd, "tsconfig.json"))) {
      languages.push("TypeScript");
    }
    if (hasExt(".js") || hasExt(".jsx")) {
      languages.push("JavaScript");
    }
    if (
      hasExt(".py") ||
      fs.existsSync(path.join(cwd, "requirements.txt")) ||
      fs.existsSync(path.join(cwd, "pyproject.toml"))
    ) {
      languages.push("Python");
    }
    if (hasExt(".rs") || fs.existsSync(path.join(cwd, "Cargo.toml"))) {
      languages.push("Rust");
    }
    if (hasExt(".go") || fs.existsSync(path.join(cwd, "go.mod"))) {
      languages.push("Go");
    }
    if (
      hasExt(".java") ||
      fs.existsSync(path.join(cwd, "pom.xml")) ||
      fs.existsSync(path.join(cwd, "build.gradle"))
    ) {
      languages.push("Java");
    }
    if (
      hasExt(".cpp") ||
      hasExt(".hpp") ||
      hasExt(".c") ||
      hasExt(".h") ||
      fs.existsSync(path.join(cwd, "CMakeLists.txt"))
    ) {
      languages.push("C/C++");
    }
  } catch {
    // Ignore readDir errors
  }

  if (languages.length === 0) {
    languages.push("General Codebase");
  }

  return { name, languages, isArive };
}

/**
 * Outputs a tailored prompt to stdin/stdout based on the target codebase context.
 */
export function outputAdvancedPrompt(): void {
  const info = detectProjectInfo();
  
  let systemContextSection = "";
  if (info.isArive) {
    systemContextSection = `The ARIVE codebase contains an advanced framework for autonomous software dev:
- SequentialEngine (src/reason/sequential_engine.ts): Maintains a SQLite-backed
  thought ledger tracking reasoning history and backtracking points.
- MemoryBank (src/reason/memory_bank.ts): Spatial semantic database (wings, rooms,
  halls, drawers) for project rules, decisions, and facts.
- ContentRouter & ast_compressor (src/analyze/): Token-saving compression (CCR)
  and codebase syntax mapping.
- WorkspaceManager & HookManager (src/integrate/): Creates isolated Git worktrees
  to execute and test tasks without dirtying the working directory.
- TDDRunner (src/verify/tdd_runner.ts): Automatic compilation and test validation
  with feedback backpropagation.`;
  } else {
    systemContextSection = `This project has been integrated with the ARIVE MCP Server. ARIVE runs in your
tool context to provide advanced capabilities and tools:
- arive_think: Track sequential thoughts and backtracking points.
- arive_compress / arive_decompress: Compact inputs (code, logs) to save tokens.
- arive_memory_bank: Store and retrieve spatial memories (rules, facts, decisions).
- arive_integrate: Create isolated Git worktrees to run tasks safely.
- arive_verify: Automatically execute test suites and catch failures.
- arive_codemap: Map folder structures and analyze exports/imports.
- arive_explain: Formulate concise, fade-style senior dev instructions.`;
  }

  const advancedPrompt = `================================================================================
ARIVE ADVANCED FRONTIER MODEL ORCHESTRATION PROMPT
================================================================================

You are an expert agentic AI software engineer operating under a high-fidelity
reasoning framework. Your goal is to update, refactor, and evolve the current
codebase to make it more robust, performant, and reliable.

Codebase: **${info.name}**
Primary Language(s): **${info.languages.join(", ")}**

To ensure correctness and eliminate hallucinated fixes, you MUST strictly adhere
to the following 5-phase sequential reasoning and verification protocol:

--------------------------------------------------------------------------------
THE FIVE-PHASE REASONING & INTEGRITY PROTOCOL
--------------------------------------------------------------------------------

1. SCOPE GATE (Context & Requirement Scoping)
   - Do NOT write code yet. Identify all relevant files, imports, and dependencies.
   - Map out the internal flow. Verify exact type signatures, classes, and helper
     functions before making changes.
   - Outline all constraints, edge cases, and interfaces that must be preserved.

2. EVIDENCE GATE (Empirical Grounding)
   - Read entire files/blocks, not just small snippets, to understand context.
   - Locate and examine all existing tests for the affected code.
   - Run existing test suites first to verify baseline behavior and reproduce bugs.

3. CHALLENGE GATE (Red-Team/Attack Analysis)
   - Actively challenge your proposed solution. Ask:
     - What race conditions, memory leaks, or performance bottlenecks might arise?
     - What happens if inputs are null, empty, unexpected, or highly concurrent?
     - Are any system-level or project-level rules violated?
     - Can the design be simplified to prevent technical debt?

4. VERIFICATION GATE (Self-Correction Loop)
   - Implement your changes, then run targeted tests.
   - If tests fail, enter a strict "Fail -> Investigate -> Verify -> Distill" loop.
   - Do not stop until all test coverage requirements are satisfied and you have
     grounded proof of correctness.

5. REPORT GATE (Synthesis & Output)
   - Summarize the precise changes made (which files and symbols were modified).
   - Provide concrete evidence of verification (test outputs, execution results).
   - Document any remaining risks, assumptions, or future roadmap items.

--------------------------------------------------------------------------------
ARIVE SYSTEM CONTEXT & TOOLING INTEGRATION
--------------------------------------------------------------------------------

${systemContextSection}

--------------------------------------------------------------------------------
INSTRUCTIONS FOR THE UPDATE / REFACTOR TASK
--------------------------------------------------------------------------------

When executing the updates requested in the user prompt:
1. Initialize the SequentialEngine/arive_think tool for tracking your reasoning.
   Record thought logs as you proceed.
2. If confused or unsure about configuration details or settings, utilize
   interactive prompting (e.g. ask tool) to query the user rather than guessing.
3. Automatically append newly created workspaces, test databases, or caching
   directories (specifically '.arive/') to the project's .gitignore.
4. Ensure all changes are covered by comprehensive unit/integration tests.
5. Provide a final Report summarizing the outcome of the 5-phase protocol.
6. Enforce a professional, objective, and emoji-free tone. Do not use informal greetings or emojis (e.g. 🚀) in any part of your output.

Proceed to implement the requested updates using this framework.
================================================================================
`;

  console.log(advancedPrompt);
}
