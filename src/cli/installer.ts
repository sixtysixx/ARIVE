import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

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
  - Mark intentional simplifications with a \`fade:\` comment.

Anti-Patterns to Avoid:
- Python: Bare 'except:', mutable defaults (e.g. def fn(x=[])), nested comprehensions, manual loop generators.
- Rust: Excess '.clone()' or '.unwrap()', verbose manual matching instead of '?' or combinators, ignoring clippy warnings.
- C/C++: Direct 'new'/'delete' (use RAII), non-const parameters, buffer overflows (strcpy), magic numbers, macro-based constants.
- C#: Missing 'using' for IDisposable, synchronous waiting on async tasks (.Result), high allocations in hot paths.
- Go: Ignored error values ('_'), naked goroutine spawns without WG/ctx, 'interface{}'/'any' where specific types/generics fit.
- HTML: Nested 'div' layouts (div-soup) lacking semantic tags, inline styles, missing accessibility attributes.
- CSS: Heavy '!important' overriding, duplicate media queries, over-specific selectors, hardcoded pixel layouts.
- JS/TS: Loose '==' equality, 'any' type casts, unhandled async rejections, nested callback structures.
- Ruby: Mutating arguments directly, over-engineered monkey patching, mutable strings, 'eval' usage.
- PHP: Raw SQL concatenation (use parameter binding), global variables/state pollution, mixing templates with controllers.
- Shell/Bash: Unquoted variables, parsing ls output, missing 'set -euo pipefail', ignoring exit codes.`;

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

const clawSkills = [
  { name: "fade", content: fadeRules },
  { name: "fade-review", content: fadeReview },
  { name: "fade-audit", content: fadeAudit },
  { name: "fade-debt", content: fadeDebt },
  { name: "fade-gain", content: fadeGain },
  { name: "fade-help", content: fadeHelp },
];

function getAppDataPath(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  return path.join(os.homedir(), ".config");
}

export function writeRuleFileWithConflict(
  filePath: string,
  content: string,
  action: "overwrite" | "append" | "skip"
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ARIVE_MARKER = "<!-- arive:fade-rules -->";
  let markedContent = content;
  if (!content.includes(ARIVE_MARKER)) {
    const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(content);
    if (match) {
      markedContent = `${match[0]}${ARIVE_MARKER}\n${content.slice(match[0].length)}`;
    } else {
      markedContent = `${ARIVE_MARKER}\n${content}`;
    }
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, markedContent, "utf-8");
    return;
  }

  if (action === "skip") return;

  const current = fs.readFileSync(filePath, "utf-8");
  if (action === "overwrite") {
    fs.writeFileSync(filePath, markedContent, "utf-8");
    return;
  }

  if (action === "append") {
    if (current.includes(ARIVE_MARKER)) return;
    fs.writeFileSync(filePath, `${current}\n\n${markedContent}`, "utf-8");
  }
}

interface MCPConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  mcp_servers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
}

function updateMCPConfig(filePath: string, command: string, args: string[]): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let config: MCPConfig = {};
    if (fs.existsSync(filePath)) {
      try {
        config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MCPConfig;
      } catch {
        config = {};
      }
    }
    if (config.mcp_servers) {
      config.mcp_servers.arive = { command, args };
    } else {
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.arive = { command, args };
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`! Failed to write MCP config to ${filePath}: ${msg}`);
  }
}

function removeMCPConfig(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    let config: MCPConfig = {};
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MCPConfig;
    } catch {
      return;
    }
    let modified = false;
    if (config.mcpServers?.arive) {
      delete config.mcpServers.arive;
      modified = true;
    }
    if (config.mcp_servers?.arive) {
      delete config.mcp_servers.arive;
      modified = true;
    }
    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`! Failed to update MCP config at ${filePath}: ${msg}`);
  }
}

function updateOpenCodeConfig(filePath: string, command: string[]): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let config: any = {};
    if (fs.existsSync(filePath)) {
      try {
        config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        config = {};
      }
    }
    if (!config.mcp) config.mcp = {};
    config.mcp.arive = { command };
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`! Failed to write OpenCode config to ${filePath}: ${msg}`);
  }
}

function removeOpenCodeConfig(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    let config: any = {};
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return;
    }
    if (config.mcp?.arive) {
      delete config.mcp.arive;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`! Failed to update OpenCode config at ${filePath}: ${msg}`);
  }
}

function removeRuleFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`! Failed to remove rule file ${filePath}: ${msg}`);
  }
}

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
    if (!isIgnored) toAdd.push(p);
  }

  if (toAdd.length > 0) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    const header = `${separator}\n# ARIVE run-time and database files\n`;
    const newLines =
      toAdd
        .map((p) => (p.endsWith("/") || p.endsWith("*") || p.includes(".") ? p : `${p}/`))
        .join("\n") + "\n";
    fs.appendFileSync(gitignorePath, header + newLines, "utf-8");
    console.log(`✓ Added to .gitignore in ${wsRoot}: ${toAdd.join(", ")}`);
  } else {
    console.log(`ℹ ARIVE paths already ignored in ${wsRoot} .gitignore.`);
  }
}

function removeFromGitignore(wsRoot: string): void {
  const gitignorePath = path.join(wsRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return;

  let content = fs.readFileSync(gitignorePath, "utf-8");
  const marker = "# ARIVE run-time and database files\n";
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return;

  const afterMarker = content.slice(markerIndex + marker.length);
  const match = afterMarker.match(/^(?:[^\n]*\n)*/);
  const removed = match ? match[0] : afterMarker;
  const cleaned =
    content.slice(0, markerIndex).replace(/\s+$/, "") +
    (removed.trim() && !content.slice(0, markerIndex).endsWith("\n\n") ? "\n" : "") +
    afterMarker.slice(removed.length).replace(/^\n+/, "");

  fs.writeFileSync(gitignorePath, cleaned, "utf-8");
  console.log(`✓ Removed ARIVE entries from .gitignore in ${wsRoot}`);
}

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
  } catch {
    // Ignore
  }
}

interface TargetOptions {
  ruleConflictAction: "overwrite" | "append" | "skip";
}

interface EditorTargetDef {
  id: string;
  aliases?: string[];
  displayName: string;
  detectPaths?: (wsRoot: string, appData: string, home: string) => string[];
  projectRule?: {
    path: (wsRoot: string) => string;
    content?: string | ((rules: string) => string);
  };
  projectMcpPath?: (wsRoot: string) => string;
  globalMcpPath?: (appData: string, home: string) => string;
  projectHooksPath?: (wsRoot: string) => string;
  globalHooksPath?: (appData: string, home: string) => string;
  customInstallProject?: (wsRoot: string, options: TargetOptions) => void;
  customInstallGlobal?: (appData: string, home: string, options: TargetOptions) => void;
  customUninstallProject?: (wsRoot: string) => void;
  customUninstallGlobal?: (appData: string, home: string) => void;
}

export const EDITOR_REGISTRY: EditorTargetDef[] = [
  {
    id: "cursor",
    displayName: "Cursor",
    detectPaths: (ws, app) => [path.join(ws, ".cursor"), path.join(app, "Cursor")],
    projectRule: {
      path: (ws) => path.join(ws, ".cursor", "rules", "fade.mdc"),
      content: (r) => `---\ndescription: Fade, lazy senior dev mode\nglobs: "*"\nalwaysApply: true\n---\n${r}`,
    },
    projectHooksPath: (ws) => path.join(ws, ".cursor", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".cursor", "mcp.json"),
    globalMcpPath: (app) =>
      path.join(app, "Cursor", "User", "globalStorage", "mohammad-rahimi.cursor-mcp", "settings", "mcp_settings.json"),
  },
  {
    id: "cline",
    displayName: "Cline",
    detectPaths: (ws, app) => [
      path.join(ws, ".cline"),
      path.join(ws, ".clinerules"),
      path.join(app, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
    ],
    projectRule: { path: (ws) => path.join(ws, ".clinerules") },
    projectHooksPath: (ws) => path.join(ws, ".cline", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".cline", "mcp.json"),
    globalMcpPath: (app) =>
      path.join(app, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
  },
  {
    id: "roo",
    aliases: ["roocode"],
    displayName: "Roo Code",
    detectPaths: (ws, app) => [
      path.join(ws, ".roo"),
      path.join(app, "Code", "User", "globalStorage", "roodev.roo-cline"),
    ],
    projectRule: { path: (ws) => path.join(ws, ".clinerules") },
    projectHooksPath: (ws) => path.join(ws, ".roo", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".roo", "mcp.json"),
    globalMcpPath: (app) =>
      path.join(app, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "cline_mcp_settings.json"),
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    detectPaths: (ws, _, home) => [path.join(ws, ".windsurf"), path.join(home, ".codeium", "windsurf")],
    projectRule: { path: (ws) => path.join(ws, ".windsurf", "rules", "fade.md") },
    projectHooksPath: (ws) => path.join(ws, ".windsurf", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".windsurf", "mcp_config.json"),
    globalMcpPath: (_, home) => path.join(home, ".codeium", "windsurf", "mcp_config.json"),
  },
  {
    id: "kiro",
    displayName: "Kiro",
    detectPaths: (ws) => [path.join(ws, ".kiro")],
    projectRule: { path: (ws) => path.join(ws, ".kiro", "steering", "fade.md") },
    projectHooksPath: (ws) => path.join(ws, ".kiro", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".kiro", "mcp.json"),
  },
  {
    id: "agents",
    displayName: "Agents",
    detectPaths: (ws) => [path.join(ws, ".agents")],
    projectRule: { path: (ws) => path.join(ws, ".agents", "rules", "fade.md") },
    projectHooksPath: (ws) => path.join(ws, ".agents", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".agents", "mcp.json"),
  },
  {
    id: "omp",
    displayName: "OMP",
    detectPaths: (ws, _, home) => [path.join(ws, ".omp"), path.join(home, ".omp")],
    projectRule: { path: (ws) => path.join(ws, ".omp", "rules", "fade.md") },
    projectHooksPath: (ws) => path.join(ws, ".omp", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".omp", "mcp.json"),
    globalMcpPath: (_, home) => path.join(home, ".omp", "agent", "mcp.json"),
    customInstallProject: (ws) => {
      const dir = path.join(ws, ".omp", "hooks");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pre-integrate.sample"),
        `#!/bin/sh\n# OMP pre-integrate hook sample\necho "Running local OMP pre-integrate hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(dir, "post-verify.sample"),
        `#!/bin/sh\n# OMP post-verify hook sample\necho "Running local OMP post-verify hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
    },
    customInstallGlobal: (_, home, opt) => {
      const globalRulePath = path.join(home, ".omp", "rules", "fade.md");
      writeRuleFileWithConflict(globalRulePath, fadeRules, opt.ruleConflictAction);
      const dir = path.join(home, ".omp", "hooks");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pre-integrate.sample"),
        `#!/bin/sh\n# OMP pre-integrate hook sample\necho "Running global OMP pre-integrate hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(dir, "post-verify.sample"),
        `#!/bin/sh\n# OMP post-verify hook sample\necho "Running global OMP post-verify hook"\nexit 0\n`,
        { encoding: "utf-8", mode: 0o755 }
      );
    },
    customUninstallGlobal: (_, home) => {
      removeRuleFile(path.join(home, ".omp", "rules", "fade.md"));
    },
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    detectPaths: (ws) => [path.join(ws, ".openclaw")],
    projectHooksPath: (ws) => path.join(ws, ".openclaw", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".openclaw", "mcp.json"),
    customInstallProject: (ws, opt) => {
      for (const skill of clawSkills) {
        const skillPath = path.join(ws, ".openclaw", "skills", skill.name, "SKILL.md");
        const content = `---\nname: ${skill.name}\ndescription: Fade ${skill.name} skill\n---\n${skill.content}`;
        writeRuleFileWithConflict(skillPath, content, opt.ruleConflictAction);
      }
    },
    customUninstallProject: (ws) => {
      for (const skill of clawSkills) {
        removeRuleFile(path.join(ws, ".openclaw", "skills", skill.name, "SKILL.md"));
      }
    },
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    detectPaths: (ws, _, home) => [
      path.join(ws, ".opencode"),
      path.join(ws, "opencode.json"),
      path.join(home, ".config", "opencode"),
    ],
    projectHooksPath: (ws) => path.join(ws, ".opencode", "hooks"),
    globalHooksPath: (_, home) => path.join(home, ".config", "opencode", "hooks"),
    customInstallProject: (ws, opt) => {
      for (const skill of clawSkills) {
        const cmdPath = path.join(ws, ".opencode", "command", `${skill.name}.md`);
        const content = `---\ndescription: Fade ${skill.name} command\n---\n${skill.content}`;
        writeRuleFileWithConflict(cmdPath, content, opt.ruleConflictAction);
      }
      const pluginsDir = path.join(ws, ".opencode", "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, "fade.mjs"), fadePlugin, "utf-8");

      const jsonPath = path.join(ws, "opencode.json");
      let cfg: { plugin?: string[] } = {};
      if (fs.existsSync(jsonPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        } catch {}
      }
      if (!cfg.plugin) cfg.plugin = [];
      if (!cfg.plugin.includes(".opencode/plugins/fade.mjs")) {
        cfg.plugin.push(".opencode/plugins/fade.mjs");
      }
      fs.writeFileSync(jsonPath, JSON.stringify(cfg, null, 2), "utf-8");
      updateOpenCodeConfig(jsonPath, ["bun", "x", "--silent", "github:sixtysixx/ARIVE"]);
    },
    customInstallGlobal: (_, home) => {
      const globalDir = path.join(home, ".config", "opencode");
      updateOpenCodeConfig(path.join(globalDir, "opencode.json"), ["bun", "x", "--silent", "github:sixtysixx/ARIVE"]);
      const pluginsDir = path.join(globalDir, "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, "fade.mjs"), fadePlugin, "utf-8");
      const commandsDir = path.join(globalDir, "command");
      fs.mkdirSync(commandsDir, { recursive: true });
      for (const skill of clawSkills) {
        fs.writeFileSync(
          path.join(commandsDir, `${skill.name}.md`),
          `---\ndescription: Fade ${skill.name} command\n---\n${skill.content}`,
          "utf-8"
        );
      }
    },
    customUninstallProject: (ws) => {
      removeRuleFile(path.join(ws, ".opencode", "plugins", "fade.mjs"));
      for (const skill of clawSkills) {
        removeRuleFile(path.join(ws, ".opencode", "command", `${skill.name}.md`));
      }
      removeOpenCodeConfig(path.join(ws, "opencode.json"));
    },
    customUninstallGlobal: (_, home) => {
      const globalDir = path.join(home, ".config", "opencode");
      removeRuleFile(path.join(globalDir, "plugins", "fade.mjs"));
      for (const skill of clawSkills) {
        removeRuleFile(path.join(globalDir, "command", `${skill.name}.md`));
      }
      removeOpenCodeConfig(path.join(globalDir, "opencode.json"));
    },
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    detectPaths: (ws, _, home) => [path.join(ws, ".antigravity"), path.join(home, ".gemini", "antigravity-cli")],
    projectRule: { path: (ws) => path.join(ws, ".antigravity", "rules", "fade.md") },
    projectHooksPath: (ws) => path.join(ws, ".antigravity", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".antigravity", "mcp_config.json"),
    globalMcpPath: (_, home) => path.join(home, ".gemini", "antigravity-cli", "mcp_config.json"),
    customInstallGlobal: (_, home) => {
      const pluginDir = path.join(home, ".gemini", "antigravity-cli", "plugins", "arive");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify(
          { name: "arive", version: "1.0.0", description: "ARIVE MCP Server and Fade rules plugin", id: "arive" },
          null,
          2
        ),
        "utf-8"
      );
      fs.writeFileSync(
        path.join(pluginDir, "mcp_config.json"),
        JSON.stringify(
          { mcpServers: { arive: { command: "bunx", args: ["--silent", "github:sixtysixx/ARIVE"] } } },
          null,
          2
        ),
        "utf-8"
      );
      const rulesDir = path.join(pluginDir, "rules");
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, "fade.md"), fadeRules, "utf-8");
      const skillsDir = path.join(pluginDir, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "SKILL.md"), `# Fade Skills\n\n${fadeRules}`, "utf-8");
      writeHookSamples(path.join(pluginDir, "hooks"));
    },
    customUninstallGlobal: (_, home) => {
      const pluginDir = path.join(home, ".gemini", "antigravity-cli", "plugins", "arive");
      if (fs.existsSync(pluginDir)) {
        try {
          fs.rmSync(pluginDir, { recursive: true, force: true });
        } catch {}
      }
    },
  },
  {
    id: "claude",
    displayName: "Claude Desktop",
    detectPaths: (ws, app) => [path.join(ws, ".claude"), path.join(ws, ".clauderules"), path.join(app, "Claude")],
    projectRule: { path: (ws) => path.join(ws, ".clauderules") },
    projectHooksPath: (ws) => path.join(ws, ".claude", "hooks"),
    globalHooksPath: (app) => path.join(app, "Claude", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".claude", "mcp.json"),
    globalMcpPath: (app) => path.join(app, "Claude", "claude_desktop_config.json"),
  },
  {
    id: "claudecode",
    displayName: "Claude Code",
    detectPaths: (ws, _, home) => [path.join(ws, ".claudecode"), path.join(home, ".config", "claude-code")],
    projectRule: { path: (ws) => path.join(ws, ".clauderules") },
    projectHooksPath: (ws) => path.join(ws, ".claudecode", "hooks"),
    globalHooksPath: (_, home) => path.join(home, ".config", "claude-code", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".claudecode", "mcp.json"),
    globalMcpPath: (_, home) => path.join(home, ".config", "claude-code", "config.json"),
  },
  {
    id: "kilocode",
    displayName: "KiloCode",
    detectPaths: (ws) => [path.join(ws, ".kilocode"), path.join(ws, ".kilocoderules")],
    projectRule: { path: (ws) => path.join(ws, ".kilocoderules") },
    projectHooksPath: (ws) => path.join(ws, ".kilocode", "hooks"),
    projectMcpPath: (ws) => path.join(ws, ".kilocode", "mcp.json"),
  },
];

export function detectInstalledEditors(wsRoot: string): string[] {
  const appData = getAppDataPath();
  const home = os.homedir();
  const detected: string[] = [];

  for (const target of EDITOR_REGISTRY) {
    if (target.detectPaths) {
      const paths = target.detectPaths(wsRoot, appData, home);
      if (paths.some((p) => fs.existsSync(p))) {
        detected.push(target.id);
      }
    }
  }
  return detected;
}

function resolveTargets(targetName?: string): EditorTargetDef[] {
  if (!targetName || targetName.toLowerCase().trim() === "all") {
    return EDITOR_REGISTRY;
  }
  const normalized = targetName.toLowerCase().trim();
  const matched = EDITOR_REGISTRY.filter(
    (t) => t.id === normalized || (t.aliases && t.aliases.includes(normalized))
  );
  return matched.length > 0 ? matched : EDITOR_REGISTRY;
}

export function executeInstallation(
  wsRoot: string,
  options: {
    target?: string;
    updateGitignore: boolean;
    ruleConflictAction: "overwrite" | "append" | "skip";
    scope: "global" | "project" | "both";
    installHooks?: boolean;
  }
): void {
  const scope = options.scope || "both";
  const installProject = scope === "project" || scope === "both";
  const installGlobal = scope === "global" || scope === "both";
  const shouldInstallHooks = options.installHooks !== false;
  const appData = getAppDataPath();
  const home = os.homedir();

  if (installProject && options.updateGitignore) {
    updateGitignore(wsRoot, [".arive"]);
  }

  if (installProject && shouldInstallHooks) {
    try {
      writeHookSamples(path.join(wsRoot, ".arive", "hooks"));
      console.log("✓ ARIVE protocol lifecycle hooks folder and samples created successfully.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`! Failed to create ARIVE hooks directory or samples: ${message}`);
    }
  }

  const targets = resolveTargets(options.target);
  const command = "bun";
  const args = ["x", "--silent", "github:sixtysixx/ARIVE"];

  if (installProject) {
    try {
      for (const target of targets) {
        if (target.projectRule) {
          const rulePath = target.projectRule.path(wsRoot);
          const content =
            typeof target.projectRule.content === "function"
              ? target.projectRule.content(fadeRules)
              : target.projectRule.content || fadeRules;
          writeRuleFileWithConflict(rulePath, content, options.ruleConflictAction);
        }
        if (target.projectHooksPath) {
          writeHookSamples(target.projectHooksPath(wsRoot));
        }
        if (target.customInstallProject) {
          target.customInstallProject(wsRoot, { ruleConflictAction: options.ruleConflictAction });
        }
      }
      console.log("✓ Successfully installed all Fade rules, skills, and plugins.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`✗ Failed to write rule/skill/plugin files: ${message}`);
    }
  }

  if (installGlobal) {
    for (const target of targets) {
      if (target.globalMcpPath) {
        updateMCPConfig(target.globalMcpPath(appData, home), command, args);
      }
      if (target.globalHooksPath) {
        writeHookSamples(target.globalHooksPath(appData, home));
      }
      if (target.customInstallGlobal) {
        target.customInstallGlobal(appData, home, { ruleConflictAction: options.ruleConflictAction });
      }
    }
  }

  if (installProject) {
    console.log("Registering project-level MCP configurations...");
    for (const target of targets) {
      if (target.projectMcpPath) {
        updateMCPConfig(target.projectMcpPath(wsRoot), command, args);
      }
    }
  }

  console.log("✓ ARIVE MCP installation completed successfully!");
}

export function executeUninstallation(
  wsRoot: string,
  options: {
    target?: string;
    updateGitignore: boolean;
    ruleConflictAction: "overwrite" | "append" | "skip";
    scope: "global" | "project" | "both";
  }
): void {
  const scope = options.scope || "both";
  const uninstallProject = scope === "project" || scope === "both";
  const uninstallGlobal = scope === "global" || scope === "both";
  const appData = getAppDataPath();
  const home = os.homedir();
  const targets = resolveTargets(options.target);

  if (uninstallProject) {
    for (const target of targets) {
      if (target.projectRule) {
        removeRuleFile(target.projectRule.path(wsRoot));
      }
      if (target.projectMcpPath) {
        removeMCPConfig(target.projectMcpPath(wsRoot));
      }
      if (target.customUninstallProject) {
        target.customUninstallProject(wsRoot);
      }
    }
  }

  if (uninstallGlobal) {
    for (const target of targets) {
      if (target.globalMcpPath) {
        removeMCPConfig(target.globalMcpPath(appData, home));
      }
      if (target.customUninstallGlobal) {
        target.customUninstallGlobal(appData, home);
      }
    }
  }

  if (uninstallProject && options.updateGitignore) {
    removeFromGitignore(wsRoot);
  }

  console.log("✓ ARIVE MCP uninstallation completed successfully!");
}

function runNonInteractiveInstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both"
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
  scope?: "global" | "project" | "both"
): void {
  executeUninstallation(workspacePath ? workspacePath : process.cwd(), {
    target: editor,
    updateGitignore: true,
    ruleConflictAction: "skip",
    scope: scope || "both",
  });
}

export function isRawTTY(): boolean {
  return !!(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.env.CI &&
    !process.env.BUN_TEST &&
    !process.env.NODE_ENV?.includes("test") &&
    !process.argv.includes("--non-interactive") &&
    !process.argv.includes("-y") &&
    !process.argv.includes("--yes")
  );
}

export function isInteractive(): boolean {
  if (process.env.CI || process.env.BUN_TEST || process.env.NODE_ENV === "test") {
    return false;
  }
  return (
    !process.argv.includes("--non-interactive") &&
    !process.argv.includes("-y") &&
    !process.argv.includes("--yes")
  );
}

export async function selectPrompt(
  message: string,
  options: string[],
  defaultIndex = 0
): Promise<string> {
  if (!isRawTTY()) {
    console.log(message);
    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}. ${options[i]}`);
    }
    const raw = prompt(`Enter a number [${defaultIndex + 1}]:`);
    if (raw === null) return options[defaultIndex];
    const parsed = parseInt(raw.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= options.length) {
      return options[parsed - 1];
    }
    return options[defaultIndex];
  }

  return new Promise<string>((resolve, reject) => {
    let selected = defaultIndex;
    let linesRendered = 0;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {}
    }
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    const cleanup = () => {
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    };

    const clearScreenLines = () => {
      if (linesRendered > 0) {
        for (let i = 0; i < linesRendered; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
      }
    };

    const render = () => {
      clearScreenLines();
      let output = `\x1b[32m?\x1b[0m \x1b[1m${message}\x1b[0m\n`;
      for (let i = 0; i < options.length; i++) {
        if (i === selected) {
          output += `  \x1b[36m\x1b[1m▸ ${options[i]}\x1b[0m\n`;
        } else {
          output += `    \x1b[90m${options[i]}\x1b[0m\n`;
        }
      }
      linesRendered = options.length + 1;
      process.stdout.write(output);
    };

    const onKeypress = (str: string | undefined, key: readline.Key) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        clearScreenLines();
        reject(new Error("Selection cancelled"));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        clearScreenLines();
        process.stdout.write(
          `\x1b[32m✔\x1b[0m \x1b[1m${message}\x1b[0m \x1b[36m${options[selected]}\x1b[0m\n`
        );
        resolve(options[selected]);
        return;
      }

      if (key.name === "up" || str === "k") {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down" || str === "j" || key.name === "space" || key.name === "tab") {
        selected = (selected + 1) % options.length;
        render();
        return;
      }

      if (str && /^[1-9]$/.test(str)) {
        const num = parseInt(str, 10);
        if (num >= 1 && num <= options.length) {
          selected = num - 1;
          render();
        }
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

export async function confirmPrompt(query: string, defaultYes = true): Promise<boolean> {
  if (!isRawTTY()) {
    const answer = prompt(`${query} (Y/n)`);
    if (answer === null) return defaultYes;
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return defaultYes;
    return normalized.startsWith("y");
  }

  return new Promise<boolean>((resolve, reject) => {
    let selected = defaultYes ? 0 : 1;
    const options = ["Yes", "No"];
    let linesRendered = 0;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {}
    }
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    const cleanup = () => {
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    };

    const clearScreenLines = () => {
      if (linesRendered > 0) {
        for (let i = 0; i < linesRendered; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
      }
    };

    const render = () => {
      clearScreenLines();
      let output = `\x1b[32m?\x1b[0m \x1b[1m${query}\x1b[0m\n`;
      for (let i = 0; i < options.length; i++) {
        if (i === selected) {
          output += `  \x1b[36m\x1b[1m▸ ${options[i]}\x1b[0m\n`;
        } else {
          output += `    \x1b[90m${options[i]}\x1b[0m\n`;
        }
      }
      linesRendered = options.length + 1;
      process.stdout.write(output);
    };

    const onKeypress = (str: string | undefined, key: readline.Key) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        clearScreenLines();
        reject(new Error("Selection cancelled"));
        return;
      }

      if (str === "y" || str === "Y") {
        selected = 0;
        cleanup();
        clearScreenLines();
        process.stdout.write(`\x1b[32m✔\x1b[0m \x1b[1m${query}\x1b[0m \x1b[36mYes\x1b[0m\n`);
        resolve(true);
        return;
      }

      if (str === "n" || str === "N") {
        selected = 1;
        cleanup();
        clearScreenLines();
        process.stdout.write(`\x1b[32m✔\x1b[0m \x1b[1m${query}\x1b[0m \x1b[36mNo\x1b[0m\n`);
        resolve(false);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        clearScreenLines();
        process.stdout.write(
          `\x1b[32m✔\x1b[0m \x1b[1m${query}\x1b[0m \x1b[36m${options[selected]}\x1b[0m\n`
        );
        resolve(selected === 0);
        return;
      }

      if (
        key.name === "left" ||
        key.name === "right" ||
        key.name === "up" ||
        key.name === "down" ||
        key.name === "space" ||
        key.name === "tab"
      ) {
        selected = selected === 0 ? 1 : 0;
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

export async function runInteractiveInstall(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both"
): Promise<void> {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  try {
    const action = await selectPrompt("What would you like to do?", ["Install", "Uninstall"], 0);

    if (action === "Uninstall") {
      await runInteractiveUninstall(workspacePath, editor, scope);
      return;
    }

    const detected = detectInstalledEditors(wsRoot);
    const editorChoices: string[] = [];
    for (const d of detected) {
      editorChoices.push(`${d} (detected)`);
    }
    for (const t of EDITOR_REGISTRY) {
      if (!detected.includes(t.id)) {
        editorChoices.push(t.id);
      }
    }
    editorChoices.push("all");

    let defaultIdx = 0;
    if (editor) {
      const matchIdx = editorChoices.findIndex(
        (c) => c === editor || c.startsWith(`${editor} `)
      );
      if (matchIdx !== -1) defaultIdx = matchIdx;
    }

    const editorChoiceRaw = editor
      ? editor
      : await selectPrompt("Which editor/config should ARIVE target?", editorChoices, defaultIdx);

    const editorChoice = editorChoiceRaw.replace(/\s*\(detected\)$/, "");

    const scopeChoice = scope
      ? scope
      : ((await selectPrompt(
          "Installation scope?",
          ["both", "project", "global"],
          0
        )) as "global" | "project" | "both");

    const handleConflict = (await selectPrompt(
      "If rule files already exist, should ARIVE overwrite, append, or skip?",
      ["append", "overwrite", "skip"],
      0
    )) as "overwrite" | "append" | "skip";

    const gitignoreChoice = await confirmPrompt(
      "Update .gitignore with ARIVE artifacts?",
      true
    );

    const installHook = await confirmPrompt("Install lifecycle hook samples?", true);

    const confirm = await confirmPrompt(
      `Proceed with installation to ${editorChoice === "all" ? "all editors" : editorChoice} (${scopeChoice})?`,
      true
    );
    if (!confirm) {
      console.log("Aborted.");
      return;
    }

    executeInstallation(wsRoot, {
      target: editorChoice === "all" ? undefined : editorChoice,
      updateGitignore: gitignoreChoice,
      ruleConflictAction: handleConflict,
      scope: scopeChoice,
      installHooks: installHook,
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
  scope?: "global" | "project" | "both"
): Promise<void> {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  try {
    const detected = detectInstalledEditors(wsRoot);
    const editorChoices: string[] = [];
    for (const d of detected) {
      editorChoices.push(`${d} (detected)`);
    }
    for (const t of EDITOR_REGISTRY) {
      if (!detected.includes(t.id)) {
        editorChoices.push(t.id);
      }
    }
    editorChoices.push("all");

    let defaultIdx = 0;
    if (editor) {
      const matchIdx = editorChoices.findIndex(
        (c) => c === editor || c.startsWith(`${editor} `)
      );
      if (matchIdx !== -1) defaultIdx = matchIdx;
    }

    const editorChoiceRaw = editor
      ? editor
      : await selectPrompt(
          "Which editor/config should ARIVE uninstall from?",
          editorChoices,
          defaultIdx
        );

    const editorChoice = editorChoiceRaw.replace(/\s*\(detected\)$/, "");

    const scopeChoice = scope
      ? scope
      : ((await selectPrompt(
          "Uninstallation scope?",
          ["both", "project", "global"],
          0
        )) as "global" | "project" | "both");

    const gitignoreChoice = await confirmPrompt(
      "Remove ARIVE entries from .gitignore?",
      true
    );

    const confirm = await confirmPrompt(
      `Proceed with uninstallation from ${editorChoice === "all" ? "all editors" : editorChoice} (${scopeChoice})?`,
      true
    );
    if (!confirm) {
      console.log("Aborted.");
      return;
    }

    executeUninstallation(wsRoot, {
      target: editorChoice === "all" ? undefined : editorChoice,
      updateGitignore: gitignoreChoice,
      ruleConflictAction: "skip",
      scope: scopeChoice,
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
  uninstall?: boolean
): Promise<void> {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  console.log(
    `Starting ARIVE installer for workspace: ${wsRoot}${editor ? ` (Target: ${editor})` : ""}${scope ? ` (Scope: ${scope})` : ""}`
  );

  if (isInteractive()) {
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
  uninstall?: boolean
): void {
  if (isInteractive()) {
    installAllAsync(workspacePath, editor, scope, uninstall).catch((e) => {
      console.error("Installation error:", e);
    });
  } else if (uninstall) {
    runNonInteractiveUninstall(workspacePath, editor, scope);
  } else {
    runNonInteractiveInstall(workspacePath, editor, scope);
  }
}

export async function installAllLegacy(
  workspacePath?: string,
  editor?: string
): Promise<void> {
  return installAllAsync(workspacePath, editor, undefined, false);
}

export async function uninstallAllAsync(
  workspacePath?: string,
  editor?: string,
  scope?: "global" | "project" | "both"
): Promise<void> {
  return installAllAsync(workspacePath, editor, scope, true);
}

export async function runInstallerCli(): Promise<void> {
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
  --non-interactive     Do not prompt for inputs
  -y, --yes             Alias for --non-interactive
  --help, -h            Show this help message
`);
      process.exit(0);
    }
  }

  if (isInteractive()) {
    await installAllAsync(workspacePath, editor, scope, uninstall);
  } else {
    installAll(workspacePath, editor, scope, uninstall);
  }
}

if (import.meta.path === Bun.main) {
  await runInstallerCli();
}
