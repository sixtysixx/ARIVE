import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { installPreCommitHook } from "./init_hooks.js";

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

// Shared Ponytail rules text
const ponytailRules = `# Ponytail, lazy senior dev mode

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
- Mark intentional simplifications with a \`ponytail:\` comment.`;

const ponytailReview = `Review diffs for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

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

const ponytailAudit = `Audit the whole repo for over-engineering and complexity. Scan the whole tree. Rank findings biggest cut first.

Tags: Same as ponytail-review (delete, stdlib, native, yagni, shrink).

Output:
One line per finding: <tag> <what to cut>. <replacement>. [path]
End with: net: -<N> lines, -<M> deps possible.`;

const ponytailDebt = `Scan the repository for 'ponytail:' comments and group them into a debt ledger.

Output:
<file>:<line>, <what was simplified>. ceiling: <limit>. upgrade: <trigger>.
End with: <N> markers.`;

const ponytailGain = `Display the ponytail scoreboard:
  ponytail gain                     benchmark median · 5 tasks · 3 models
  Lines of code   no-skill  ████████████████████  100%
                  ponytail  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  ponytail  █████▌··············   23–53%  ▼ 47–77%
  Speed           ponytail  ▸ 3–6× faster`;

const ponytailHelp = `# Ponytail Help
Levels:
- Lite: Suggest lazier alternative in one line.
- Full: The ladder enforced (YAGNI -> stdlib -> native -> minimum).
- Ultra: Extremist YAGNI. Deletion first. Challenge requirements.

Deactivate:
Say 'stop ponytail' or 'normal mode'.`;

const ponytailPlugin = `// ponytail — OpenCode plugin
export default async ({ client } = {}) => {
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push("PONYTAIL ACTIVE: Follow lazy senior developer rules.");
    }
  };
};`;

export function installAll(workspacePath?: string): void {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  const rootDir = path.resolve(process.cwd());
  const relativePath = path.relative(rootDir, wsRoot);
  const isOutside =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (isOutside && wsRoot !== rootDir) {
    throw new Error(
      `Security Exception: Workspace path "${wsRoot}" is outside the allowed project directory.`,
    );
  }

  console.log(`Starting ARIVE installer for workspace: ${wsRoot}`);

  // 1. Install Git pre-commit hooks if inside Git repository
  const gitDir = path.join(wsRoot, ".git");
  if (fs.existsSync(gitDir)) {
    try {
      installPreCommitHook();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`! Failed to install pre-commit hook: ${message}`);
    }
  } else {
    console.log("ℹ Not a git repository, skipping Git hook installation.");
  }

  // 2. Install Ponytail Rules, Skills & Plugins
  try {
    // A. Cursor
    const cursorRulesDir = path.join(wsRoot, ".cursor", "rules");
    fs.mkdirSync(cursorRulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorRulesDir, "ponytail.mdc"),
      `---\ndescription: Ponytail, lazy senior dev mode\nglobs: "*"\nalwaysApply: true\n---\n${ponytailRules}`,
      "utf-8",
    );

    // B. Cline, Roo Code
    fs.writeFileSync(path.join(wsRoot, ".clinerules"), ponytailRules, "utf-8");

    // C. Windsurf
    const windsurfDir = path.join(wsRoot, ".windsurf", "rules");
    fs.mkdirSync(windsurfDir, { recursive: true });
    fs.writeFileSync(
      path.join(windsurfDir, "ponytail.md"),
      ponytailRules,
      "utf-8",
    );

    // D. Kiro
    const kiroDir = path.join(wsRoot, ".kiro", "steering");
    fs.mkdirSync(kiroDir, { recursive: true });
    fs.writeFileSync(path.join(kiroDir, "ponytail.md"), ponytailRules, "utf-8");

    // E. Agents
    const agentsDir = path.join(wsRoot, ".agents", "rules");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "ponytail.md"),
      ponytailRules,
      "utf-8",
    );

    // F. OpenClaw Skills
    const clawSkills = [
      { name: "ponytail", content: ponytailRules },
      { name: "ponytail-review", content: ponytailReview },
      { name: "ponytail-audit", content: ponytailAudit },
      { name: "ponytail-debt", content: ponytailDebt },
      { name: "ponytail-gain", content: ponytailGain },
      { name: "ponytail-help", content: ponytailHelp },
    ];

    for (const skill of clawSkills) {
      const skillDir = path.join(wsRoot, ".openclaw", "skills", skill.name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${skill.name}\ndescription: Ponytail ${skill.name} skill\n---\n${skill.content}`,
        "utf-8",
      );
    }

    // G. OpenCode Commands & Plugins
    for (const skill of clawSkills) {
      const cmdDir = path.join(wsRoot, ".opencode", "command");
      fs.mkdirSync(cmdDir, { recursive: true });
      fs.writeFileSync(
        path.join(cmdDir, `${skill.name}.md`),
        `---\ndescription: Ponytail ${skill.name} command\n---\n${skill.content}`,
        "utf-8",
      );
    }

    const opencodePluginsDir = path.join(wsRoot, ".opencode", "plugins");
    fs.mkdirSync(opencodePluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(opencodePluginsDir, "ponytail.mjs"),
      ponytailPlugin,
      "utf-8",
    );

    // Write opencode.json if not present or append plugin
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
    if (!opencodeConfig.plugin.includes(".opencode/plugins/ponytail.mjs")) {
      opencodeConfig.plugin.push(".opencode/plugins/ponytail.mjs");
    }
    fs.writeFileSync(
      opencodeJsonPath,
      JSON.stringify(opencodeConfig, null, 2),
      "utf-8",
    );

    console.log(
      "✓ Successfully installed all Ponytail rules, skills, and plugins.",
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`✗ Failed to write rule/skill/plugin files: ${message}`);
  }

  // 3. Register MCP configurations globally
  const command = "bunx";
  const args = ["--silent", "github:sixtysixx/ARIVE"];

  // A. Antigravity CLI config
  const antigravityConfigPath = path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "mcp_config.json",
  );
  updateMCPConfig(antigravityConfigPath, command, args);

  // B. Claude Desktop
  const appData = getAppDataPath();
  const claudeDesktopConfigPath = path.join(
    appData,
    "Claude",
    "claude_desktop_config.json",
  );
  updateMCPConfig(claudeDesktopConfigPath, command, args);

  // C. Claude Code
  const claudeCodeConfigPath = path.join(
    os.homedir(),
    ".config",
    "claude-code",
    "config.json",
  );
  updateMCPConfig(claudeCodeConfigPath, command, args);

  // D. Cline Global config
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

  // E. Roo Code Global config
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

  // F. Cursor Global config
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

  // G. Windsurf Global config
  const windsurfGlobalConfigPath = path.join(
    os.homedir(),
    ".codeium",
    "windsurf",
    "mcp_config.json",
  );
  updateMCPConfig(windsurfGlobalConfigPath, command, args);

  // H. OpenCode Global config
  const opencodeGlobalConfigPath = path.join(
    os.homedir(),
    ".config",
    "opencode",
    "opencode.json",
  );
  updateOpenCodeConfig(opencodeGlobalConfigPath, [command, ...args]);

  // I. OMP Global config
  const ompGlobalConfigPath = path.join(
    os.homedir(),
    ".omp",
    "agent",
    "mcp.json",
  );
  updateMCPConfig(ompGlobalConfigPath, command, args);

  // 4. Register local project-level MCP configurations in the workspace
  console.log("Registering project-level MCP configurations...");

  // OMP project config
  const ompProjectConfig = path.join(wsRoot, ".omp", "mcp.json");
  updateMCPConfig(ompProjectConfig, command, args);

  // Cursor project config
  const cursorProjectConfig = path.join(wsRoot, ".cursor", "mcp.json");
  updateMCPConfig(cursorProjectConfig, command, args);

  // Cline project config
  const clineProjectConfig = path.join(wsRoot, ".cline", "mcp.json");
  updateMCPConfig(clineProjectConfig, command, args);

  // Roo Code project config
  const rooProjectConfig = path.join(wsRoot, ".roo", "mcp.json");
  updateMCPConfig(rooProjectConfig, command, args);

  // KiloCode project config
  const kilocodeProjectConfig = path.join(wsRoot, ".kilocode", "mcp.json");
  updateMCPConfig(kilocodeProjectConfig, command, args);

  // OpenCode project config
  const opencodeProjectConfig = path.join(wsRoot, "opencode.json");
  updateOpenCodeConfig(opencodeProjectConfig, [command, ...args]);

  console.log("✓ ARIVE MCP installation completed successfully!");
}

// Run if called directly
if (import.meta.path === Bun.main) {
  installAll();
}
