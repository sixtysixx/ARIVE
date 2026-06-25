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

export function installAll(workspacePath?: string, editor?: string): void {
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

  const target = editor ? editor.toLowerCase().trim() : undefined;
  const validEditors = [
    "cursor",
    "cline",
    "roo",
    "roocode",
    "windsurf",
    "kiro",
    "agents",
    "openclaw",
    "opencode",
    "kilocode",
    "antigravity",
    "claude",
    "claudecode",
    "omp",
  ];
  if (target && !validEditors.includes(target)) {
    console.warn(
      `! Warning: "${target}" is not a recognized editor. Installing for all editors instead.`,
    );
  }

  console.log(
    `Starting ARIVE installer for workspace: ${wsRoot}${target ? ` (Target: ${target})` : ""}`,
  );

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

  // 1.5. Create ARIVE hooks directory and samples
  try {
    const ariveHooksDir = path.join(wsRoot, ".arive", "hooks");
    fs.mkdirSync(ariveHooksDir, { recursive: true });

    const preIntegrateSample = `#!/bin/sh
# ARIVE pre-integrate hook sample
# This hook runs before a task workspace is created, command is executed, or cleaned up.
#
# Available environment variables:
# - ARIVE_HOOK_NAME: name of the hook (e.g. pre-integrate)
# - ARIVE_HOOK_PHASE: ARIVE phase (e.g. integrate)
# - ARIVE_HOOK_CONTEXT: JSON-stringified argument context (e.g. {"taskId": "task-123", "action": "execute"})
#
# To enable this hook, rename this file to "pre-integrate" (without .sample) and make it executable.
# Exit with non-zero code to block the execution of the integration action.

echo "Running pre-integrate hook for task: \\$ARIVE_HOOK_CONTEXT"
exit 0
`;

    const postVerifySample = `#!/bin/sh
# ARIVE post-verify hook sample
# This hook runs after the verify tests run.
#
# Available environment variables:
# - ARIVE_HOOK_NAME: name of the hook (e.g. post-verify)
# - ARIVE_HOOK_PHASE: ARIVE phase (e.g. verify)
# - ARIVE_HOOK_CONTEXT: JSON-stringified argument context (e.g. {"taskId": "task-123", "testCommand": "bun test"})
# - ARIVE_HOOK_RESULT: JSON-stringified result (e.g. {"success": true, "failures": []})
#
# To enable this hook, rename this file to "post-verify" (without .sample) and make it executable.

echo "Verify result: \\$ARIVE_HOOK_RESULT"
exit 0
`;

    fs.writeFileSync(
      path.join(ariveHooksDir, "pre-integrate.sample"),
      preIntegrateSample,
      { encoding: "utf-8", mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(ariveHooksDir, "post-verify.sample"),
      postVerifySample,
      { encoding: "utf-8", mode: 0o755 },
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

  // 2. Install Ponytail Rules, Skills & Plugins
  try {
    const clawSkills = [
      { name: "ponytail", content: ponytailRules },
      { name: "ponytail-review", content: ponytailReview },
      { name: "ponytail-audit", content: ponytailAudit },
      { name: "ponytail-debt", content: ponytailDebt },
      { name: "ponytail-gain", content: ponytailGain },
      { name: "ponytail-help", content: ponytailHelp },
    ];

    // A. Cursor
    if (target === undefined || target === "cursor") {
      const cursorRulesDir = path.join(wsRoot, ".cursor", "rules");
      fs.mkdirSync(cursorRulesDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorRulesDir, "ponytail.mdc"),
        `---\ndescription: Ponytail, lazy senior dev mode\nglobs: "*"\nalwaysApply: true\n---\n${ponytailRules}`,
        "utf-8",
      );
    }

    // B. Cline, Roo Code
    if (
      target === undefined ||
      target === "cline" ||
      target === "roo" ||
      target === "roocode"
    ) {
      fs.writeFileSync(
        path.join(wsRoot, ".clinerules"),
        ponytailRules,
        "utf-8",
      );
    }

    // C. Windsurf
    if (target === undefined || target === "windsurf") {
      const windsurfDir = path.join(wsRoot, ".windsurf", "rules");
      fs.mkdirSync(windsurfDir, { recursive: true });
      fs.writeFileSync(
        path.join(windsurfDir, "ponytail.md"),
        ponytailRules,
        "utf-8",
      );
    }

    // D. Kiro
    if (target === undefined || target === "kiro") {
      const kiroDir = path.join(wsRoot, ".kiro", "steering");
      fs.mkdirSync(kiroDir, { recursive: true });
      fs.writeFileSync(
        path.join(kiroDir, "ponytail.md"),
        ponytailRules,
        "utf-8",
      );
    }

    // E. Agents
    if (target === undefined || target === "agents") {
      const agentsDir = path.join(wsRoot, ".agents", "rules");
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, "ponytail.md"),
        ponytailRules,
        "utf-8",
      );
    }

    // F. OpenClaw Skills
    if (target === undefined || target === "openclaw") {
      for (const skill of clawSkills) {
        const skillDir = path.join(wsRoot, ".openclaw", "skills", skill.name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          `---\nname: ${skill.name}\ndescription: Ponytail ${skill.name} skill\n---\n${skill.content}`,
          "utf-8",
        );
      }
    }

    // G. OpenCode Commands & Plugins
    if (target === undefined || target === "opencode") {
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

      // Install global plugins & commands
      const opencodeGlobalDir = path.join(os.homedir(), ".config", "opencode");
      const globalPluginsDir = path.join(opencodeGlobalDir, "plugins");
      fs.mkdirSync(globalPluginsDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalPluginsDir, "ponytail.mjs"),
        ponytailPlugin,
        "utf-8",
      );

      const globalCommandsDir = path.join(opencodeGlobalDir, "command");
      fs.mkdirSync(globalCommandsDir, { recursive: true });
      for (const skill of clawSkills) {
        fs.writeFileSync(
          path.join(globalCommandsDir, `${skill.name}.md`),
          `---\ndescription: Ponytail ${skill.name} command\n---\n${skill.content}`,
          "utf-8",
        );
      }
    }

    // H. Antigravity Plugin
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
            description: "ARIVE MCP Server and Ponytail rules plugin",
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
        path.join(antigravityRulesDir, "ponytail.md"),
        ponytailRules,
        "utf-8",
      );

      const antigravitySkillsDir = path.join(antigravityPluginDir, "skills");
      fs.mkdirSync(antigravitySkillsDir, { recursive: true });
      fs.writeFileSync(
        path.join(antigravitySkillsDir, "SKILL.md"),
        `# Ponytail Skills\n\n${ponytailRules}`,
        "utf-8",
      );
    }

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
  if (target === undefined || target === "antigravity") {
    const antigravityConfigPath = path.join(
      os.homedir(),
      ".gemini",
      "antigravity-cli",
      "mcp_config.json",
    );
    updateMCPConfig(antigravityConfigPath, command, args);
  }

  // B. Claude Desktop
  if (target === undefined || target === "claude") {
    const appData = getAppDataPath();
    const claudeDesktopConfigPath = path.join(
      appData,
      "Claude",
      "claude_desktop_config.json",
    );
    updateMCPConfig(claudeDesktopConfigPath, command, args);
  }

  // C. Claude Code
  if (target === undefined || target === "claudecode") {
    const claudeCodeConfigPath = path.join(
      os.homedir(),
      ".config",
      "claude-code",
      "config.json",
    );
    updateMCPConfig(claudeCodeConfigPath, command, args);
  }

  // D. Cline Global config
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

  // E. Roo Code Global config
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

  // F. Cursor Global config
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

  // G. Windsurf Global config
  if (target === undefined || target === "windsurf") {
    const windsurfGlobalConfigPath = path.join(
      os.homedir(),
      ".codeium",
      "windsurf",
      "mcp_config.json",
    );
    updateMCPConfig(windsurfGlobalConfigPath, command, args);
  }

  // H. OpenCode Global config
  if (target === undefined || target === "opencode") {
    const opencodeGlobalConfigPath = path.join(
      os.homedir(),
      ".config",
      "opencode",
      "opencode.json",
    );
    updateOpenCodeConfig(opencodeGlobalConfigPath, [command, ...args]);
  }

  // I. OMP Global config
  if (target === undefined || target === "omp") {
    const ompGlobalConfigPath = path.join(
      os.homedir(),
      ".omp",
      "agent",
      "mcp.json",
    );
    updateMCPConfig(ompGlobalConfigPath, command, args);
  }
  // 4. Register local project-level MCP configurations in the workspace
  console.log("Registering project-level MCP configurations...");

  // OMP project config
  if (target === undefined || target === "omp") {
    const ompProjectConfig = path.join(wsRoot, ".omp", "mcp.json");
    updateMCPConfig(ompProjectConfig, command, args);
  }

  // Cursor project config
  if (target === undefined || target === "cursor") {
    const cursorProjectConfig = path.join(wsRoot, ".cursor", "mcp.json");
    updateMCPConfig(cursorProjectConfig, command, args);
  }

  // Cline project config
  if (target === undefined || target === "cline") {
    const clineProjectConfig = path.join(wsRoot, ".cline", "mcp.json");
    updateMCPConfig(clineProjectConfig, command, args);
  }

  // Roo Code project config
  if (target === undefined || target === "roo" || target === "roocode") {
    const rooProjectConfig = path.join(wsRoot, ".roo", "mcp.json");
    updateMCPConfig(rooProjectConfig, command, args);
  }

  // KiloCode project config
  if (target === undefined || target === "kilocode") {
    const kilocodeProjectConfig = path.join(wsRoot, ".kilocode", "mcp.json");
    updateMCPConfig(kilocodeProjectConfig, command, args);
  }

  // OpenCode project config
  if (target === undefined || target === "opencode") {
    const opencodeProjectConfig = path.join(wsRoot, "opencode.json");
    updateOpenCodeConfig(opencodeProjectConfig, [command, ...args]);
  }
  console.log("✓ ARIVE MCP installation completed successfully!");
}

export function runInstallerCli(): void {
  let editor: string | undefined = undefined;
  let workspacePath: string | undefined = undefined;

  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--editor" || arg === "-e") {
      editor = process.argv[i + 1];
    } else if (arg === "--path" || arg === "-p") {
      workspacePath = process.argv[i + 1];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`ARIVE MCP Installer CLI
Usage:
  arive install [options]

Options:
  --editor, -e <name>   Target a specific AI editor (e.g. cursor, cline, roo, windsurf, opencode, kilocode, claude, claudecode, antigravity, omp)
  --path, -p <path>     Workspace root path (default: current directory)
  --help, -h            Show this help message
`);
      process.exit(0);
    }
  }

  installAll(workspacePath, editor);
}

// Run if called directly
if (import.meta.path === Bun.main) {
  runInstallerCli();
}
