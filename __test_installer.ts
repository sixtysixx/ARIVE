import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { installPreCommitHook, installPreCommitHookSync } from "./init_hooks.js";

// Types
interface MCPConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args: string[];
    }
  >;
}

interface OpenCodeConfig {
  mcp?: Record<
    string,
    {
      type: string;
      command: string[];
      enabled: boolean;
    }
  >;
  plugin?: string[];
}

// Helper to resolve app data directories
function getAppDataPath(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return path.join(os.homedir(), ".config");
}

/**
 * Helper to write a rule file and handle conflicts (overwrite, append, skip).
 */
export function writeRuleFileWithConflict(
  filePath: string,
  content: string,
  action: "overwrite" | "append" | "skip",
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf-8");
    return;
  }

  if (action === "skip") {
    return;
  }

  if (action === "overwrite") {
    fs.writeFileSync(filePath, content, "utf-8");
    return;
  }

  if (action === "append") {
    const current = fs.readFileSync(filePath, "utf-8");
    const contentFirstLine = content.split("\n")[0] || "";
    if (contentFirstLine && current.includes(contentFirstLine)) {
      return;
    }
    if (current.includes("Fade, lazy senior dev mode") && content.includes("Fade, lazy senior dev mode")) {
      return;
    }
    if (current.includes(content.trim())) {
      return;
    }
    fs.writeFileSync(filePath, `${current}\n\n${content}`, "utf-8");
  }
}

// Update helper for normal MCP JSON configs
function updateMCPConfig(
  filePath: string,
  command: string,
  args: string[],
): void {
  try {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let config: MCPConfig = {};
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        config = JSON.parse(content) as MCPConfig;
      } catch {
        // Ignore parsing errors and start fresh
      }
    }

    if (!config || typeof config !== "object") {
      config = {};
    }

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    config.mcpServers["arive"] = {
      command,
      args,
    };

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`✓ Registered ARIVE MCP server in: ${filePath}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to update config at ${filePath}: ${message}`);
  }
}

// Update helper for OpenCode configs
function updateOpenCodeConfig(filePath: string, command: string[]): void {
  try {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let config: OpenCodeConfig = {};
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        config = JSON.parse(content) as OpenCodeConfig;
      } catch {
        // Ignore parsing errors and start fresh
      }
    }

    if (!config || typeof config !== "object") {
      config = {};
    }

    if (!config.mcp || typeof config.mcp !== "object") {
      config.mcp = {};
    }

    config.mcp["arive"] = {
      type: "local",
      command,
      enabled: true,
    };

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
    console.log(
      `✓ Registered ARIVE MCP server in OpenCode config: ${filePath}`,
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `✗ Failed to update OpenCode config at ${filePath}: ${message}`,
    );
  }
}

// Uninstall helpers — mirror the install helpers but remove entries instead of writing them
function removeMCPConfig(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`ℹ MCP config not found, skipping: ${filePath}`);
      return;
    }
    let config: MCPConfig = {};
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      config = JSON.parse(content) as MCPConfig;
    } catch {
      // If we can't parse it, leave it alone
      return;
    }
    if (!config || typeof config !== "object") return;

    if (config.mcpServers && config.mcpServers["arive"]) {
      delete config.mcpServers["arive"];
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`✓ Removed ARIVE MCP server entry from: ${filePath}`);
    } else {
      console.log(`ℹ No ARIVE MCP entry found in: ${filePath}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to remove MCP config at ${filePath}: ${message}`);
  }
}

function removeOpenCodeConfig(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`ℹ OpenCode config not found, skipping: ${filePath}`);
      return;
    }
    let config: OpenCodeConfig = {};
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      config = JSON.parse(content) as OpenCodeConfig;
    } catch {
      return;
    }
    if (!config || typeof config !== "object") return;

    let changed = false;

    // Remove mcp.arive entry
    if (config.mcp && config.mcp["arive"]) {
      delete config.mcp["arive"];
      if (Object.keys(config.mcp).length === 0) {
        delete config.mcp;
      }
      changed = true;
    }

    // Remove plugin entry if present
    if (Array.isArray(config.plugin)) {
      const filtered = config.plugin.filter((entry) => entry !== ".opencode/plugins/fade.mjs");
      if (filtered.length !== config.plugin.length) {
        config.plugin = filtered;
      }
    }

    if (changed || !config.plugin) {
      delete config.plugin;
    }

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`✓ Removed ARIVE OpenCode entry from: ${filePath}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to update OpenCode config at ${filePath}: ${message}`);
  }
}

function removeRuleFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { recursive: true, force: true });
      console.log(`✓ Removed ARIVE rule file: ${filePath}`);
    } else {
      console.log(`ℹ No ARIVE rule file found at: ${filePath}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to remove ARIVE rule file at ${filePath}: ${message}`);
  }
}

// Shared Fade rules text
const fadeRules = `# Fade, lazy senior dev mode

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller.

Rules:
- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- Mark intentional simplifications with a \`fade:\` comment.`;

const fadeReview = `Review diffs for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

Format:
L<line>: <tag> <what>. <replacement>., or <file>:L<line>: ... for multi-file diffs.

Tags:
- delete: dead code, unused flexibility.
- stdlib: hand-rolled thing the standard library ships.
- native: dependency or code doing what the platform already does.
- yagni: abstraction with one implementation, config nobody sets.
- shrink: same logic, fewer lines.

Scoring:
End with: net: -<N> lines possible.`;

const fadeAudit = `Audit the whole repo for over-engineering and complexity. Scan the whole tree. Rank findings biggest cut first.

Tags: Same as fade-review (delete, stdlib, native, yagni, shrink).

Output:
One line per finding: <tag> <what to cut>. <replacement>. [path]
End with: net: -<N> lines, -<M> deps possible.`;

const fadeDebt = `Scan the repository for 'fade:' comments and group them into a debt ledger.

Output:
<file>:<line>, <what was simplified>. ceiling: <limit>. upgrade: <trigger>.
End with: <N> markers.`;

const fadeGain = `Display the fade scoreboard:
  fade gain                     benchmark median · 5 tasks · 3 models
  Lines of code   no-skill  ████████████████████  100%
                  fade  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  fade  █████▌··············   23–53%  ▼ 47–77%
  Speed           fade  ▸ 3–6× faster`;

const fadeHelp = `# Fade Help
Levels:
- Lite: Suggest lazier alternative in one line.
- Full: The ladder enforced (YAGNI -> stdlib -> native -> minimum).
- Ultra: Extremist YAGNI. Deletion first. Challenge requirements.

Deactivate:
Say 'stop fade' or 'normal mode'.`;

const fadePlugin = `// fade — OpenCode plugin
export default async ({ client } = {}) => {
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push("FADE ACTIVE: Follow lazy senior developer rules.");
    }
  };
};`;

// Helper to update gitignore
function updateGitignore(wsRoot: string, pathsToIgnore: string[]): void {
  const gitignorePath = path.join(wsRoot, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf-8");
  }

  const lines = content.split(/\r?\n/);
  const toAdd: string[] = [];

  const expandedPaths: string[] = [];
  for (const p of pathsToIgnore) {
    if (p === ".arive") {
      expandedPaths.push(
        ".arive/*.db",
        ".arive/*.db-shm",
        ".arive/*.db-wal",
        ".arive/workspaces/",
        ".arive/logs/"
      );
    } else {
      expandedPaths.push(p);
    }
  }

  for (const p of expandedPaths) {
    const isIgnored = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === p ||
        trimmed === `${p}/` ||
        trimmed === `/${p}` ||
        (p.endsWith("/") && (trimmed === p.slice(0, -1) || trimmed === `/${p.slice(0, -1)}`))
      );
    });
    if (!isIgnored) {
      toAdd.push(p);
    }
  }

  if (toAdd.length > 0) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    const header = `${separator}\n# ARIVE run-time and database files\n`;
    const newLines = toAdd.map((p) => {
      if (p.endsWith("/") || p.endsWith("*") || p.includes(".")) {
        return p;
      }
      return `${p}/`;
    }).join("\n") + "\n";
    fs.appendFileSync(gitignorePath, header + newLines, "utf-8");
    console.log(`✓ Added to .gitignore in ${wsRoot}: ${toAdd.join(", ")}`);
  } else {
    console.log(`ℹ ARIVE paths already ignored in ${wsRoot} .gitignore.`);
  }
}

function removeFromGitignore(wsRoot: string): void {
  const gitignorePath = path.join(wsRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  let content = fs.readFileSync(gitignorePath, "utf-8");
  const marker = "# ARIVE run-time and database files\n";
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return;
  }

  const afterMarker = content.slice(markerIndex + marker.length);
  const match = afterMarker.match(/^(?:[^\n]*\n)*/);
  const removed = match ? match[0] : afterMarker;
  const cleaned = content
    .slice(0, markerIndex)
    .replace(/\s+$/, "") +
    (removed.trim() && !content.slice(0, markerIndex).endsWith("\n\n") ? "\n" : "") +
    afterMarker.slice(removed.length).replace(/^\n+/, "");

  fs.writeFileSync(gitignorePath, cleaned, "utf-8");
  console.log(`✓ Removed ARIVE entries from .gitignore in ${wsRoot}`);
}


// Helper to write lifecycle hooks samples
function writeHookSamples(hooksDir: string): void {
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "pre-integrate.sample"),
      `#!/bin/sh\n# ARIVE pre-integrate hook sample\n# This hook runs before a task workspace is created, command is executed, or cleaned up.\nexit 0\n`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(hooksDir, "post-verify.sample"),
      `#!/bin/sh\n# ARIVE post-verify hook sample\n# This hook runs after the verify tests run.\nexit 0\n`,
      { encoding: "utf-8", mode: 0o755 }
    );
  } catch (e: unknown) {
    // Ignore error silently
  }
}

// Shared implementation containing actual file writes & config registrations
function executeInstallation(
  wsRoot: string,
  options: {
    target?: string;
    updateGitignore: boolean;
    ruleConflictAction: "overwrite" | "append" | "skip";
    scope: "global" | "project" | "both";
  }
): void {
  const target = options.target ? options.target.toLowerCase().trim() : undefined;
  const scope = options.scope || "both";
  const installProject = scope === "project" || scope === "both";
  const installGlobal = scope === "global" || scope === "both";

  if (installProject && options.updateGitignore) {
    updateGitignore(wsRoot, [".arive"]);
  }

  if (installProject) {
    try {
      const ariveHooksDir = path.join(wsRoot, ".arive", "hooks");
      fs.mkdirSync(ariveHooksDir, { recursive: true });

      fs.writeFileSync(
        path.join(ariveHooksDir, "pre-integrate.sample"),
        `#!/bin/sh\n# ARIVE pre-integrate hook sample\n# This hook runs before a task workspace is created, command is executed, or cleaned up.\n#\n# Available environment variables:\n# - ARIVE_HOOK_NAME: name of the hook (e.g. pre-integrate)\n# - ARIVE_HOOK_PHASE: ARIVE phase (e.g. integrate)\n# - ARIVE_HOOK_CONTEXT: JSON-stringified argument context (e.g. {"taskId": "task-123", "action": "execute"})\n#\n# To enable this hook, rename this file to "pre-integrate" (without .sample) and make it executable.\n# Exit with non-zero code to block the execution of the integration action.\n\necho "Running pre-integrate hook for task: \\$ARIVE_HOOK_CONTEXT"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(ariveHooksDir, "post-verify.sample"),
        `#!/bin/sh\n# ARIVE post-verify hook sample\n# This hook runs after the verify tests run.\n#\n# Available environment variables:\n# - ARIVE_HOOK_NAME: name of the hook (e.g. post-verify)\n# - ARIVE_HOOK_PHASE: ARIVE phase (e.g. verify)\n# - ARIVE_HOOK_CONTEXT: JSON-stringified argument context (e.g. {"taskId": "task-123", "testCommand": "bun test"})\n# - ARIVE_HOOK_RESULT: JSON-stringified result (e.g. {"success": true, "failures": []})\n#\n# To enable this hook, rename this file to "post-verify" (without .sample) and make it executable.\n\necho "Verify result: \\$ARIVE_HOOK_RESULT"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      console.log(
        "✓ ARIVE protocol lifecycle hooks folder and samples created successfully.",
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(
        `! Failed to create ARIVE hooks directory or samples: ${message}`,
      );
    }
  }

  try {
    const clawSkills = [
      { name: "fade", content: fadeRules },
      { name: "fade-review", content: fadeReview },
      { name: "fade-audit", content: fadeAudit },
      { name: "fade-debt", content: fadeDebt },
      { name: "fade-gain", content: fadeGain },
      { name: "fade-help", content: fadeHelp },
    ];

    if (target === undefined || target === "cursor") {
      const rulePath = path.join(wsRoot, ".cursor", "rules", "fade.mdc");
      const content = `---\ndescription: Fade, lazy senior dev mode\nglobs: "*"\nalwaysApply: true\n---\n${fadeRules}`;
      writeRuleFileWithConflict(rulePath, content, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".cursor", "hooks"));
    }

    if (
      target === undefined ||
      target === "cline" ||
      target === "roo" ||
      target === "roocode"
    ) {
      const rulePath = path.join(wsRoot, ".clinerules");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".cline", "hooks"));
      writeHookSamples(path.join(wsRoot, ".roo", "hooks"));
    }

    if (target === undefined || target === "windsurf") {
      const rulePath = path.join(wsRoot, ".windsurf", "rules", "fade.md");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".windsurf", "hooks"));
    }

    if (target === undefined || target === "kiro") {
      const rulePath = path.join(wsRoot, ".kiro", "steering", "fade.md");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".kiro", "hooks"));
    }

    if (target === undefined || target === "agents") {
      const rulePath = path.join(wsRoot, ".agents", "rules", "fade.md");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".agents", "hooks"));
    }

    if (target === undefined || target === "omp") {
      const rulePath = path.join(wsRoot, ".omp", "rules", "fade.md");
      const rulesDir = path.dirname(rulePath);
      fs.mkdirSync(rulesDir, { recursive: true });
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);

      const globalRulePath = path.join(os.homedir(), ".omp", "rules", "fade.md");
      const globalRulesDir = path.dirname(globalRulePath);
      fs.mkdirSync(globalRulesDir, { recursive: true });
      writeRuleFileWithConflict(globalRulePath, fadeRules, options.ruleConflictAction);

      // Local OMP hooks
      const localHooksDir = path.join(wsRoot, ".omp", "hooks");
      fs.mkdirSync(localHooksDir, { recursive: true });
      fs.writeFileSync(
        path.join(localHooksDir, "pre-integrate.sample"),
        `#!/bin/sh\n# OMP pre-integrate hook sample\necho "Running local OMP pre-integrate hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(localHooksDir, "post-verify.sample"),
        `#!/bin/sh\n# OMP post-verify hook sample\necho "Running local OMP post-verify hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );

      // Global OMP hooks
      const globalHooksDir = path.join(os.homedir(), ".omp", "hooks");
      fs.mkdirSync(globalHooksDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalHooksDir, "pre-integrate.sample"),
        `#!/bin/sh\n# OMP pre-integrate hook sample\necho "Running global OMP pre-integrate hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(globalHooksDir, "post-verify.sample"),
        `#!/bin/sh\n# OMP post-verify hook sample\necho "Running global OMP post-verify hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
    }
    if (target === undefined || target === "openclaw") {
      for (const skill of clawSkills) {
        const skillPath = path.join(wsRoot, ".openclaw", "skills", skill.name, "SKILL.md");
        const content = `---\nname: ${skill.name}\ndescription: Fade ${skill.name} skill\n---\n${skill.content}`;
        writeRuleFileWithConflict(skillPath, content, options.ruleConflictAction);
      }
      writeHookSamples(path.join(wsRoot, ".openclaw", "hooks"));
    }

    if (target === undefined || target === "opencode") {
      for (const skill of clawSkills) {
        const cmdPath = path.join(wsRoot, ".opencode", "command", `${skill.name}.md`);
        const content = `---\ndescription: Fade ${skill.name} command\n---\n${skill.content}`;
        writeRuleFileWithConflict(cmdPath, content, options.ruleConflictAction);
      }

      const opencodePluginsDir = path.join(wsRoot, ".opencode", "plugins");
      fs.mkdirSync(opencodePluginsDir, { recursive: true });
      fs.writeFileSync(
        path.join(opencodePluginsDir, "fade.mjs"),
        fadePlugin,
        "utf-8",
      );

      const opencodeJsonPath = path.join(wsRoot, "opencode.json");
      let opencodeConfig: { plugin?: string[] } = {};
      if (fs.existsSync(opencodeJsonPath)) {
        try {
          opencodeConfig = JSON.parse(
            fs.readFileSync(opencodeJsonPath, "utf-8"),
          ) as { plugin?: string[] };
        } catch {
          // Ignore
        }
      }
      if (!opencodeConfig.plugin) {
        opencodeConfig.plugin = [];
      }
      if (!opencodeConfig.plugin.includes(".opencode/plugins/fade.mjs")) {
        opencodeConfig.plugin.push(".opencode/plugins/fade.mjs");
      }
      fs.writeFileSync(
        opencodeJsonPath,
        JSON.stringify(opencodeConfig, null, 2),
        "utf-8",
      );

      const opencodeGlobalDir = path.join(os.homedir(), ".config", "opencode");
      const globalPluginsDir = path.join(opencodeGlobalDir, "plugins");
      fs.mkdirSync(globalPluginsDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalPluginsDir, "fade.mjs"),
        fadePlugin,
        "utf-8",
      );

      const globalCommandsDir = path.join(opencodeGlobalDir, "command");
      fs.mkdirSync(globalCommandsDir, { recursive: true });
      for (const skill of clawSkills) {
        fs.writeFileSync(
          path.join(globalCommandsDir, `${skill.name}.md`),
          `---\ndescription: Fade ${skill.name} command\n---\n${skill.content}`,
          "utf-8",
        );
      }

      writeHookSamples(path.join(wsRoot, ".opencode", "hooks"));
      writeHookSamples(path.join(opencodeGlobalDir, "hooks"));
    }

    if (target === undefined || target === "antigravity") {
      const antigravityPluginDir = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "plugins",
        "arive",
      );
      fs.mkdirSync(antigravityPluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(antigravityPluginDir, "plugin.json"),
        JSON.stringify(
          {
            name: "arive",
            version: "1.0.0",
            description: "ARIVE MCP Server and Fade rules plugin",
            id: "arive",
          },
          null,
          2,
        ),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(antigravityPluginDir, "mcp_config.json"),
        JSON.stringify(
          {
            mcpServers: {
              arive: {
                command: "bunx",
                args: ["--silent", "github:sixtysixx/ARIVE"],
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const antigravityRulesDir = path.join(antigravityPluginDir, "rules");
      fs.mkdirSync(antigravityRulesDir, { recursive: true });
      fs.writeFileSync(
        path.join(antigravityRulesDir, "fade.md"),
        fadeRules,
        "utf-8",
      );

      const antigravitySkillsDir = path.join(antigravityPluginDir, "skills");
      fs.mkdirSync(antigravitySkillsDir, { recursive: true });
      fs.writeFileSync(
        path.join(antigravitySkillsDir, "SKILL.md"),
        `# Fade Skills\n\n${fadeRules}`,
        "utf-8",
      );

      // Local Antigravity rules and hooks
      const localAntigravityRulesDir = path.join(wsRoot, ".antigravity", "rules");
      fs.mkdirSync(localAntigravityRulesDir, { recursive: true });
      writeRuleFileWithConflict(
        path.join(localAntigravityRulesDir, "fade.md"),
        fadeRules,
        options.ruleConflictAction
      );
      writeHookSamples(path.join(wsRoot, ".antigravity", "hooks"));
      writeHookSamples(path.join(antigravityPluginDir, "hooks"));
    }

    // Claude Local Rules & Hooks
    if (target === undefined || target === "claude") {
      const rulePath = path.join(wsRoot, ".clauderules");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".claude", "hooks"));

      const appData = getAppDataPath();
      writeHookSamples(path.join(appData, "Claude", "hooks"));
    }

    // ClaudeCode Local Rules & Hooks
    if (target === undefined || target === "claudecode") {
      const rulePath = path.join(wsRoot, ".clauderules");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".claudecode", "hooks"));

      const globalClaudeCodeDir = path.join(os.homedir(), ".config", "claude-code");
      writeHookSamples(path.join(globalClaudeCodeDir, "hooks"));
    }

    // Kilocode Local Rules & Hooks
    if (target === undefined || target === "kilocode") {
      const rulePath = path.join(wsRoot, ".kilocoderules");
      writeRuleFileWithConflict(rulePath, fadeRules, options.ruleConflictAction);
      writeHookSamples(path.join(wsRoot, ".kilocode", "hooks"));
    }

    console.log(
      "✓ Successfully installed all Fade rules, skills, and plugins.",
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to write rule/skill/plugin files: ${message}`);
  }

  const command = "bunx";
  const args = ["--silent", "github:sixtysixx/ARIVE"];

  if (installGlobal) {
    if (target === undefined || target === "antigravity") {
      const antigravityConfigPath = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "mcp_config.json",
      );
      updateMCPConfig(antigravityConfigPath, command, args);
    }

    if (target === undefined || target === "claude") {
      const appData = getAppDataPath();
      const claudeDesktopConfigPath = path.join(
        appData,
        "Claude",
        "claude_desktop_config.json",
      );
      updateMCPConfig(claudeDesktopConfigPath, command, args);
    }

    if (target === undefined || target === "claudecode") {
      const claudeCodeConfigPath = path.join(
        os.homedir(),
        ".config",
        "claude-code",
        "config.json",
      );
      updateMCPConfig(claudeCodeConfigPath, command, args);
    }

    if (target === undefined || target === "cline") {
      const appData = getAppDataPath();
      const clineGlobalConfigPath = path.join(
        appData,
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json",
      );
      updateMCPConfig(clineGlobalConfigPath, command, args);
    }

    if (target === undefined || target === "roo" || target === "roocode") {
      const appData = getAppDataPath();
      const rooGlobalConfigPath = path.join(
        appData,
        "Code",
        "User",
        "globalStorage",
        "roodev.roo-cline",
        "settings",
        "cline_mcp_settings.json",
      );
      updateMCPConfig(rooGlobalConfigPath, command, args);
    }

    if (target === undefined || target === "cursor") {
      const appData = getAppDataPath();
      const cursorGlobalConfigPath = path.join(
        appData,
        "Cursor",
        "User",
        "globalStorage",
        "mohammad-rahimi.cursor-mcp",
        "settings",
        "mcp_settings.json",
      );
      updateMCPConfig(cursorGlobalConfigPath, command, args);
    }

    if (target === undefined || target === "windsurf") {
      const windsurfGlobalConfigPath = path.join(
        os.homedir(),
        ".codeium",
        "windsurf",
        "mcp_config.json",
      );
      updateMCPConfig(windsurfGlobalConfigPath, command, args);
    }

    if (target === undefined || target === "opencode") {
      const opencodeGlobalConfigPath = path.join(
        os.homedir(),
        ".config",
        "opencode",
        "opencode.json",
      );
      updateOpenCodeConfig(opencodeGlobalConfigPath, [command, ...args]);
    }

    if (target === undefined || target === "omp") {
      const ompGlobalConfigPath = path.join(
        os.homedir(),
        ".omp",
        "agent",
        "mcp.json",
      );
      updateMCPConfig(ompGlobalConfigPath, command, args);
    }
  }

  console.log("Registering project-level MCP configurations...");

  if (installProject) {
    if (target === undefined || target === "omp") {
      const ompProjectConfig = path.join(wsRoot, ".omp", "mcp.json");
      updateMCPConfig(ompProjectConfig, command, args);
    }

    if (target === undefined || target === "cursor") {
      const cursorProjectConfig = path.join(wsRoot, ".cursor", "mcp.json");
      updateMCPConfig(cursorProjectConfig, command, args);
    }

    if (target === undefined || target === "cline") {
      const clineProjectConfig = path.join(wsRoot, ".cline", "mcp.json");
      updateMCPConfig(clineProjectConfig, command, args);
    }

    if (target === undefined || target === "roo" || target === "roocode") {
      const rooProjectConfig = path.join(wsRoot, ".roo", "mcp.json");
      updateMCPConfig(rooProjectConfig, command, args);
    }

    if (target === undefined || target === "kilocode") {
      const kilocodeProjectConfig = path.join(wsRoot, ".kilocode", "mcp.json");
      updateMCPConfig(kilocodeProjectConfig, command, args);
    }

    if (target === undefined || target === "windsurf") {
      const windsurfProjectConfig = path.join(wsRoot, ".windsurf", "mcp_config.json");
      updateMCPConfig(windsurfProjectConfig, command, args);
    }

    if (target === undefined || target === "kiro") {
      const kiroProjectConfig = path.join(wsRoot, ".kiro", "mcp.json");
      updateMCPConfig(kiroProjectConfig, command, args);
    }

    if (target === undefined || target === "agents") {
      const agentsProjectConfig = path.join(wsRoot, ".agents", "mcp.json");
      updateMCPConfig(agentsProjectConfig, command, args);
    }

    if (target === undefined || target === "openclaw") {
      const openclawProjectConfig = path.join(wsRoot, ".openclaw", "mcp.json");
      updateMCPConfig(openclawProjectConfig, command, args);
    }

    if (target === undefined || target === "antigravity") {
      const antigravityProjectConfig = path.join(wsRoot, ".antigravity", "mcp_config.json");
      updateMCPConfig(antigravityProjectConfig, command, args);
    }

    if (target === undefined || target === "claude") {
      const claudeProjectConfig = path.join(wsRoot, ".claude", "mcp.json");
      updateMCPConfig(claudeProjectConfig, command, args);
    }

    if (target === undefined || target === "claudecode") {
      const claudecodeProjectConfig = path.join(wsRoot, ".claudecode", "mcp.json");
      updateMCPConfig(claudecodeProjectConfig, command, args);
    }

    if (target === undefined || target === "opencode") {
      const opencodeProjectConfig = path.join(wsRoot, "opencode.json");
      updateOpenCodeConfig(opencodeProjectConfig, [command, ...args]);
    }
  }
  console.log("✓ ARIVE MCP installation completed successfully!");
}

// Uninstallation
function executeUninstallation(
  wsRoot: string,
  options: {
    target?: string;
    updateGitignore: boolean;
    ruleConflictAction: "overwrite" | "append" | "skip";
    scope: "global" | "project" | "both";
  }
): void {
  const target = options.target ? options.target.toLowerCase().trim() : undefined;
  const scope = options.scope || "both";
  const uninstallProject = scope === "project" || scope === "both";
  const uninstallGlobal = scope === "global" || scope === "both";

  if (options.updateGitignore) {
    removeFromGitignore(wsRoot);
  }

  if (uninstallProject) {
    const ariveHooksDir = path.join(wsRoot, ".arive", "hooks");
    try {
      fs.rmSync(ariveHooksDir, { recursive: true, force: true });
      console.log(`✓ Removed ARIVE hooks samples from ${wsRoot}.`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`! Failed to remove ARIVE hooks: ${message}`);
    }

    const targets = [
      ["cursor", path.join(wsRoot, ".cursor", "rules", "fade.mdc")],
      ["windsurf", path.join(wsRoot, ".windsurf", "rules", "fade.md")],
      ["kiro", path.join(wsRoot, ".kiro", "steering", "fade.md")],
      ["agents", path.join(wsRoot, ".agents", "rules", "fade.md")],
      ["openclaw", path.join(wsRoot, ".openclaw", "rules", "fade.md")],
      ["kilocode", path.join(wsRoot, ".kilocoderules")],
    ];

    for (const [key, rulePath] of targets) {
      if (target === undefined || target === key) {
        removeRuleFile(rulePath);
      }
    }

    const multiTargets = ["cline", "roo", "roocode"];
    if (target === undefined || multiTargets.includes(target)) {
      removeRuleFile(path.join(wsRoot, ".clinerules"));
      writeHookSamples(path.join(wsRoot, ".cline", "hooks"));
      writeHookSamples(path.join(wsRoot, ".roo", "hooks"));
    }

    if (target === undefined || target === "omp") {
      const rulePath = path.join(wsRoot, ".omp", "rules", "fade.md");
      const globalRulePath = path.join(os.homedir(), ".omp", "rules", "fade.md");
      removeRuleFile(rulePath);
      removeRuleFile(globalRulePath);
      fs.rmSync(path.join(wsRoot, ".omp", "hooks"), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".omp", "hooks"), { recursive: true, force: true });
    }

    if (target === undefined || target === "opencode") {
      const commandDir = path.join(wsRoot, ".opencode", "command");
      const globalPluginsDir = path.join(os.homedir(), ".config", "opencode", "plugins");
      const globalCommandsDir = path.join(os.homedir(), ".config", "opencode", "command");
      fs.rmSync(commandDir, { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, ".opencode", "plugins"), { recursive: true, force: true });
      fs.rmSync(globalPluginsDir, { recursive: true, force: true });
      fs.rmSync(globalCommandsDir, { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, ".opencode", "hooks"), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".config", "opencode", "hooks"), { recursive: true, force: true });
    }

    if (target === undefined || target === "antigravity") {
      const pluginDir = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "plugins",
        "arive",
      );
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, ".antigravity", "rules"), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, ".antigravity", "hooks"), { recursive: true, force: true });
    }

    if (target === undefined || target === "claude") {
      removeRuleFile(path.join(wsRoot, ".clauderules"));
      const appData = getAppDataPath();
      fs.rmSync(path.join(wsRoot, ".claude", "hooks"), { recursive: true, force: true });
      fs.rmSync(path.join(appData, "Claude", "hooks"), { recursive: true, force: true });
    }

    if (target === undefined || target === "claudecode") {
      removeRuleFile(path.join(wsRoot, ".clauderules"));
      const globalClaudeCodeDir = path.join(os.homedir(), ".config", "claude-code");
      fs.rmSync(path.join(wsRoot, ".claudecode", "hooks"), { recursive: true, force: true });
      fs.rmSync(path.join(globalClaudeCodeDir, "hooks"), { recursive: true, force: true });
    }

    console.log("✓ Uninstalled ARIVE project rules, hooks, and plugins.");
  }

  if (uninstallGlobal) {
    if (target === undefined || target === "clade") {
      const appData = getAppDataPath();
      removeMCPConfig(path.join(appData, "Claude", "claude_desktop_config.json"));
    }

    if (target === undefined || target === "claude-code") {
      removeMCPConfig(path.join(os.homedir(), ".config", "claude-code", "config.json"));
    }

    if (target === undefined || target === "cline") {
      const appData = getAppDataPath();
      removeMCPConfig(
        path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
      );
    }

    if (target === undefined || target === "roo" || target === "roocode") {
      const appData = getAppDataPath();
      removeMCPConfig(
        path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "cline_mcp_settings.json")
      );
    }

    if (target === undefined || target === "cursor") {
      const appData = getAppDataPath();
      removeMCPConfig(
        path.join(appData, "Cursor", "User", "globalStorage", "mohammad-rahimi.cursor-mcp", "settings", "mcp_settings.json")
      );
    }

    if (target === undefined || target === "windsurf") {
      removeMCPConfig(path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"));
    }

    if (target === undefined || target === "opencode") {
      const globalConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
      removeOpenCodeConfig(globalConfigPath);
    }

    if (target === undefined || target === "omp") {
      removeMCPConfig(path.join(os.homedir(), ".omp", "agent", "mcp.json"));
    }
    console.log("✓ Uninstalled ARIVE global MCP configurations.");
  }

  // Project-level MCP config removal
  if (uninstallProject) {
    if (target === undefined || target === "omp") {
      removeMCPConfig(path.join(wsRoot, ".omp", "mcp.json"));
    }

    if (target === undefined || target === "cursor") {
      removeMCPConfig(path.join(wsRoot, ".cursor", "mcp.json"));
    }

    if (target === undefined || target === "cline") {
      removeMCPConfig(path.join(wsRoot, ".cline", "mcp.json"));
    }

    if (target === undefined || target === "roo" || target === "roocode") {
      removeMCPConfig(path.join(wsRoot, ".roo", "mcp.json"));
    }

    if (target === undefined || target === "kilocode") {
      removeMCPConfig(path.join(wsRoot, ".kilocode", "mcp.json"));
    }

    if (target === undefined || target === "windsurf") {
      removeMCPConfig(path.join(wsRoot, ".windsurf", "mcp_config.json"));
    }

    if (target === undefined || target === "kiro") {
      removeMCPConfig(path.join(wsRoot, ".kiro", "mcp.json"));
    }

    if (target === undefined || target === "agents") {
      removeMCPConfig(path.join(wsRoot, ".agents", "mcp.json"));
    }

    if (target === undefined || target === "openclaw") {
      removeMCPConfig(path.join(wsRoot, ".openclaw", "mcp.json"));
    }

    if (target === undefined || target === "antigravity") {
      removeMCPConfig(path.join(wsRoot, ".antigravity", "mcp_config.json"));
    }

    if (target === undefined || target === "claude") {
      removeMCPConfig(path.join(wsRoot, ".claude", "mcp.json"));
    }

    if (target === undefined || target === "claudecode") {
      removeMCPConfig(path.join(wsRoot, ".claudecode", "mcp.json"));
    }

    if (target === undefined || target === "opencode") {
      removeOpenCodeConfig(path.join(wsRoot, "opencode.json"));
    }
  }
  console.log("✓ ARIVE MCP uninstallation completed successfully!");

function runNonInteractiveInstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
): void {
  executeInstallation(workspacePath ? workspacePath : process.cwd(), {
    target: editor,
    updateGitignore: true,
    ruleConflictAction: "append",
    scope: scope || "both",
  });
}

function runNonInteractiveUninstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
): void {
  executeUninstallation(workspacePath ? workspacePath : process.cwd(), {
    target: editor,
    updateGitignore: true,
    ruleConflictAction: "skip",
    scope: scope || "both",
  });
}

function isRawTTY(): boolean {
  return (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.env.CI &&
    !process.argv.includes("--non-interactive")
  );
}

async function selectPrompt(message: string, options: string[], defaultIndex = 0): Promise<string> {
  if (!isRawTTY()) {
    console.log(message);
    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}. ${options[i]}`);
    }
    const raw = prompt(`Enter a number [${defaultIndex + 1}]:`);
    if (raw === null) {
      return options[defaultIndex];
    }
    const parsed = parseInt(raw.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= options.length) {
      return options[parsed - 1];
    }
    return options[defaultIndex];
  }

  return new Promise<string>((resolve) => {
    let selected = defaultIndex;
    process.stdout.write("\x1b[?25l");
    const cleanup = () => {
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("data", onData);
    };
    const render = () => {
      let output = `${message}\n`;
      for (let i = 0; i < options.length; i++) {
        const marker = i === selected ? "\x1b[7m" : "";
        const reset = i === selected ? "\x1b[0m" : "";
        output += `  ${marker} ${options[i]} ${reset}\n`;
      }
      output += `\x1b[${options.length + 1}A`;
      process.stdout.write(output);
    };
    const onData = (chunk: Buffer) => {
      if (chunk.includes(Buffer.from("\x03"))) {
        cleanup();
        process.exit(0);
      }
      if (chunk.includes("\r") || chunk.includes("\n")) {
        process.stdout.write(`\x1b[${options.length + 1}B`);
        console.log(`Selected: ${options[selected]}`);
        cleanup();
        resolve(options[selected]);
        return;
      }
      if (chunk.toString("utf-8").includes("\u0009") || chunk.includes(Buffer.from(" "))) {
        const current = options[selected];
        const next = options[(selected + 1) % options.length];
        selected = options.indexOf(next) >= 0 ? options.indexOf(next, selected) : (selected + 1) % options.length;
        render();
        return;
      }
      if (chunk.includes(Buffer.from("\x1b[A"))) {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }
      if (chunk.includes(Buffer.from("\x1b[B"))) {
        selected = (selected + 1) % options.length;
        render();
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
    render();
  });
}

async function confirmPrompt(query: string, defaultYes = true): Promise<boolean> {
  if (!isRawTTY()) {
    const answer = prompt(`${query} (Y/n)`);
    if (answer === null) return defaultYes;
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return defaultYes;
    return normalized.startsWith("y");
  }

  return new Promise<boolean>((resolve) => {
    let selected = defaultYes ? 0 : 1;
    const options = ["Yes", "No"];
    process.stdout.write("\x1b[?25l");
    const cleanup = () => {
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("data", onData);
    };
    const render = () => {
      let output = `${query}\n`;
      for (let i = 0; i < options.length; i++) {
        const marker = i === selected ? "\x1b[7m" : "";
        const reset = i === selected ? "\x1b[0m" : "";
        output += `  ${marker} ${options[i]} ${reset}\n`;
      }
      output += `\x1b[${options.length + 1}A`;
      process.stdout.write(output);
    };
    const onData = (chunk: Buffer) => {
      if (chunk.includes(Buffer.from("\x03"))) {
        cleanup();
        process.exit(0);
      }
      if (chunk.includes("\r") || chunk.includes("\n")) {
        process.stdout.write(`\x1b[${options.length + 1}B`);
        console.log(`Selected: ${options[selected]}`);
        cleanup();
        resolve(selected === 0);
        return;
      }
      if (chunk.includes(Buffer.from("\u0009")) || chunk.includes(Buffer.from(" "))) {
        selected = selected === 0 ? 1 : 0;
        render();
        return;
      }
      if (chunk.includes(Buffer.from("\x1b[A"))) {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }
      if (chunk.includes(Buffer.from("\x1b[B"))) {
        selected = (selected + 1) % options.length;
        render();
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
    render();
  });
}

async function runInteractiveInstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
): Promise<void> {
  try {
    const action = await selectPrompt("What would you like to do?", ["Install", "Uninstall"], 0);

    if (action === "Uninstall") {
      await runInteractiveUninstall(workspacePath, editor, scope);
      return;
    }

    const editorChoice = editor
      ? editor
      : await selectPrompt(
          "Which editor/config should ARIVE target?",
          [
            "all",
            "cursor",
            "cline",
            "roo",
            "windsurf",
            "opencode",
            "kilocode",
            "claude",
            "claudecode",
            "antigravity",
            "omp",
          ],
          0,
        );

    const scopeChoice = scope
      ? scope
      : await selectPrompt("Installation scope?", ["global", "project", "both"], 2);

    const outsideWorkspace = await confirmPrompt(
      `Some editors store files outside this workspace.\nProceed anyway?`,
      true,
    );
    if (!outsideWorkspace) {
      console.log("Aborted.");
      return;
    }

    const handleConflict = await selectPrompt(
      "If rule files already exist, should ARIVE overwrite, append, or skip?",
      ["overwrite", "append", "skip"],
      1,
    );

    const gitignoreChoice = await confirmPrompt(
      "Update .gitignore with ARIVE artifacts?",
      true,
    );

    const installHook = await confirmPrompt(
      "Install lifecycle hook samples?",
      true,
    );

    executeInstallation(workspacePath ? workspacePath : process.cwd(), {
      target: editorChoice === "all" ? undefined : editorChoice,
      updateGitignore: gitignoreChoice,
      ruleConflictAction: handleConflict as "overwrite" | "append" | "skip",
      scope: scopeChoice as "global" | "project" | "both",
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Selection cancelled") {
      console.log("Installation aborted by user.");
      return;
    }
    throw e;
  }
}

async function runInteractiveUninstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
): Promise<void> {
  try {
    const editorChoice = editor
      ? editor
      : await selectPrompt(
          "Which editor/config should ARIVE uninstall from?",
          [
            "all",
            "cursor",
            "cline",
            "roo",
            "windsurf",
            "opencode",
            "kilocode",
            "claude",
            "claudecode",
            "antigravity",
            "omp",
          ],
          0,
        );

    const scopeChoice = scope
      ? scope
      : await selectPrompt("Uninstallation scope?", ["global", "project", "both"], 2);

    const gitignoreChoice = await confirmPrompt(
      "Remove ARIVE entries from .gitignore?",
      true,
    );

    executeUninstallation(workspacePath ? workspacePath : process.cwd(), {
      target: editorChoice === "all" ? undefined : editorChoice,
      updateGitignore: gitignoreChoice,
      ruleConflictAction: "skip",
      scope: scopeChoice as "global" | "project" | "both",
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Selection cancelled") {
      console.log("Uninstallation aborted by user.");
      return;
    }
    throw e;
  }
}


export async function installAllAsync(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
  uninstall?: boolean,
): Promise<void> {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  console.log(
    `Starting ARIVE installer for workspace: ${wsRoot}${editor ? ` (Target: ${editor})` : ""}${scope ? ` (Scope: ${scope})` : ""}`,
  );

  if (isRawTTY()) {
    if (uninstall) {
      await runInteractiveUninstall(workspacePath, editor, scope);
    } else {
      await runInteractiveInstall(workspacePath, editor, scope);
    }
  } else if (uninstall) {
    runNonInteractiveUninstall(workspacePath, editor, scope);
  } else {
    runNonInteractiveInstall(workspacePath, editor, scope);
  }
}

export function installAll(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
  uninstall?: boolean,
): void {
  if (isRawTTY()) {
    installAllAsync(workspacePath, editor, scope, uninstall);
  } else if (uninstall) {
    runNonInteractiveUninstall(workspacePath, editor, scope);
  } else {
    runNonInteractiveInstall(workspacePath, editor, scope);
  }
}

export async function installAllLegacy(
  workspacePath?: string,
  editor?: string,
): Promise<void> {
  return installAllAsync(workspacePath, editor, undefined, false);
}

export async function uninstallAllAsync(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both",
): Promise<void> {
  return installAllAsync(workspacePath, editor, scope, true);
}

export function runInstallerCli(): void {
  let editor: string | undefined = undefined;
  let workspacePath: string | undefined = undefined;
  let scope: "global" | "project" | "both" | undefined = undefined;
  let uninstall = false;

  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--editor" || arg === "-e" || arg === "--agent" || arg === "-a") {
      editor = process.argv[i + 1];
    } else if (arg === "--path" || arg === "-p") {
      workspacePath = process.argv[i + 1];
    } else if (arg === "--scope" || arg === "-s") {
      const val = process.argv[i + 1]?.toLowerCase().trim();
      if (val === "global" || val === "project" || val === "both") {
        scope = val as "global" | "project" | "both";
      } else {
        console.error(`Error: Invalid scope "${val}". Allowed values: global, project, both`);
        process.exit(1);
      }
    } else if (arg === "--uninstall" || arg === "-u") {
      uninstall = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`ARIVE MCP Installer/Uninstaller CLI
Usage:
  arive install [options]

Options:
  --editor, -e <name>   Target a specific AI editor/agent (e.g. cursor, cline, roo, windsurf, opencode, kilocode, claude, claudecode, antigravity, omp)
  --agent, -a <name>    Alias for --editor
  --scope, -s <scope>   Installation scope: global, project, both (default: both)
  --path, -p <path>     Workspace root path (default: current directory)
  --uninstall, -u       Uninstall ARIVE instead of installing
  --help, -h            Show this help message
`);
      process.exit(0);
    }
  }

  installAll(workspacePath, editor, scope, uninstall);
}

if (import.meta.path === Bun.main) {
  runInstallerCli();
}

