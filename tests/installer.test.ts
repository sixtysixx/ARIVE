import { mock, expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

let mockHomedirPath = "";

// Mock the 'os' module before importing installer
mock.module("os", () => {
  const actualOs = require("os");
  return {
    ...actualOs,
    homedir: () => mockHomedirPath || actualOs.homedir(),
  };
});

// Import installer after mock is registered
import { installAll, writeRuleFileWithConflict, isInteractive, isRawTTY } from "../src/cli/installer.js";

describe("Installer Editor Targeting", () => {
  let tempDir: string;
  let originalAppData: string | undefined;
  let originalCwd: () => string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(
      path.join(require("os").tmpdir(), "arive-install-test-"),
    );
    mockHomedirPath = tempDir;
    originalAppData = process.env.APPDATA;
    originalCwd = process.cwd;

    // Redirect APPDATA and cwd to tempDir to avoid modifying actual system configs
    process.env.APPDATA = path.join(tempDir, "AppData");
    process.cwd = () => tempDir;
  });

  afterAll(() => {
    // Restore
    mockHomedirPath = "";
    process.cwd = originalCwd;
    if (originalAppData !== undefined) {
      process.env.APPDATA = originalAppData;
    } else {
      delete process.env.APPDATA;
    }

    // Clean up tempDir
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  test("installs only Cursor configuration when targeted", () => {
    const wsRoot = path.join(tempDir, "workspace");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Run installer specifically for cursor
    installAll(wsRoot, "cursor");

    // Cursor local config should exist
    expect(fs.existsSync(path.join(wsRoot, ".cursor", "mcp.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".cursor", "rules", "fade.mdc")),
    ).toBe(true);

    // Cline local config should NOT exist
    expect(fs.existsSync(path.join(wsRoot, ".cline", "mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(wsRoot, ".clinerules"))).toBe(false);

    // Windsurf rules should NOT exist
    expect(fs.existsSync(path.join(wsRoot, ".windsurf"))).toBe(false);
  });

  test("installs only Cline configuration when targeted", () => {
    const wsRoot = path.join(tempDir, "workspace-cline");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Run installer specifically for cline
    installAll(wsRoot, "cline");

    // Cline local config should exist
    expect(fs.existsSync(path.join(wsRoot, ".cline", "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(wsRoot, ".clinerules"))).toBe(true);

    // Cursor local config should NOT exist
    expect(fs.existsSync(path.join(wsRoot, ".cursor"))).toBe(false);
  });

  test("installs global Antigravity plugin structure when targeted", () => {
    const wsRoot = path.join(tempDir, "workspace-antigravity");
    fs.mkdirSync(wsRoot, { recursive: true });

    installAll(wsRoot, "antigravity");

    const pluginDir = path.join(
      tempDir,
      ".gemini",
      "antigravity-cli",
      "plugins",
      "arive",
    );
    expect(fs.existsSync(path.join(pluginDir, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "mcp_config.json"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "rules", "fade.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(pluginDir, "skills", "SKILL.md"))).toBe(
      true,
    );
  });

  test("installs global and local OpenCode plugin structure when targeted", () => {
    const wsRoot = path.join(tempDir, "workspace-opencode");
    fs.mkdirSync(wsRoot, { recursive: true });

    installAll(wsRoot, "opencode");

    // Local
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md")),
    ).toBe(true);

    // Global
    const globalPluginsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "plugins",
    );
    const globalCommandsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "command",
    );
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(
      true,
    );
  });

  test("updates gitignore during installation", () => {
    const wsRoot = path.join(tempDir, "workspace-gitignore");
    fs.mkdirSync(wsRoot, { recursive: true });
    
    // Create initial .gitignore
    const gitignorePath = path.join(wsRoot, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules\n", "utf-8");

    // Run installation
    installAll(wsRoot, "cursor");

    // Check if .arive/ was appended
    const content = fs.readFileSync(gitignorePath, "utf-8");
    expect(content).toContain(".arive/");
  });

  test("installs only project-level configs when scope is project", () => {
    const wsRoot = path.join(tempDir, "workspace-scope-project");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Clean up homedir mock configs if any
    const globalPluginsDir = path.join(tempDir, ".config", "opencode", "plugins");
    const globalCommandsDir = path.join(tempDir, ".config", "opencode", "command");
    if (fs.existsSync(globalPluginsDir)) fs.rmSync(globalPluginsDir, { recursive: true, force: true });
    if (fs.existsSync(globalCommandsDir)) fs.rmSync(globalCommandsDir, { recursive: true, force: true });

    installAll(wsRoot, "opencode", "project");

    // Local should exist
    expect(fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md"))).toBe(true);

    // Global should NOT exist
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(false);
  });

  test("installs only global-level configs when scope is global", () => {
    const wsRoot = path.join(tempDir, "workspace-scope-global");
    fs.mkdirSync(wsRoot, { recursive: true });

    const globalPluginsDir = path.join(tempDir, ".config", "opencode", "plugins");
    const globalCommandsDir = path.join(tempDir, ".config", "opencode", "command");
    if (fs.existsSync(globalPluginsDir)) fs.rmSync(globalPluginsDir, { recursive: true, force: true });
    if (fs.existsSync(globalCommandsDir)) fs.rmSync(globalCommandsDir, { recursive: true, force: true });

    installAll(wsRoot, "opencode", "global");

    // Local should NOT exist
    expect(fs.existsSync(path.join(wsRoot, ".opencode"))).toBe(false);

    // Global should exist
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(true);
  });

  test("installs both local and global configs when scope is both", () => {
    const wsRoot = path.join(tempDir, "workspace-scope-both");
    fs.mkdirSync(wsRoot, { recursive: true });

    const globalPluginsDir = path.join(tempDir, ".config", "opencode", "plugins");
    const globalCommandsDir = path.join(tempDir, ".config", "opencode", "command");
    if (fs.existsSync(globalPluginsDir)) fs.rmSync(globalPluginsDir, { recursive: true, force: true });
    if (fs.existsSync(globalCommandsDir)) fs.rmSync(globalCommandsDir, { recursive: true, force: true });

    installAll(wsRoot, "opencode", "both");

    // Local should exist
    expect(fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md"))).toBe(true);

    // Global should exist
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(true);
  });

  test("uninstalls cursor config correctly", () => {
    const wsRoot = path.join(tempDir, "workspace-uninst-cursor");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Install cursor config
    installAll(wsRoot, "cursor");

    // Verify install worked
    const mcpJson = path.join(wsRoot, ".cursor", "mcp.json");
    expect(fs.existsSync(mcpJson)).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".cursor", "rules", "fade.mdc")),
    ).toBe(true);

    // Verify MCP config has arive entry
    const config = JSON.parse(fs.readFileSync(mcpJson, "utf-8"));
    expect(config.mcpServers?.arive).toBeDefined();

    // Uninstall cursor config (uninstall=true)
    installAll(wsRoot, "cursor", "both", true);

    // Verify files removed
    expect(
      fs.existsSync(path.join(wsRoot, ".cursor", "rules", "fade.mdc")),
    ).toBe(false);

    // MCP config no longer has arive entry (file still exists but entry removed)
    if (fs.existsSync(mcpJson)) {
      const updatedConfig = JSON.parse(fs.readFileSync(mcpJson, "utf-8"));
      expect(updatedConfig.mcpServers?.arive).toBeUndefined();
    }
  });

  test("uninstalls only project-level configs when scope is project", () => {
    const wsRoot = path.join(tempDir, "workspace-uninst-scope-project");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Install opencode with both scopes
    installAll(wsRoot, "opencode");

    // Verify local files exist
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md")),
    ).toBe(true);

    // Verify global files exist
    const globalPluginsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "plugins",
    );
    const globalCommandsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "command",
    );
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(
      true,
    );

    // Uninstall with scope project
    installAll(wsRoot, "opencode", "project", true);

    // Local should be removed
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md")),
    ).toBe(false);

    // Global should remain
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(
      true,
    );
  });

  test("uninstalls only global-level configs when scope is global", () => {
    const wsRoot = path.join(tempDir, "workspace-uninst-scope-global");
    fs.mkdirSync(wsRoot, { recursive: true });

    // Install opencode with both scopes
    installAll(wsRoot, "opencode");

    // Verify local files exist
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md")),
    ).toBe(true);

    // Verify global files exist
    const globalPluginsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "plugins",
    );
    const globalCommandsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "command",
    );
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(
      true,
    );

    // Uninstall with scope global
    installAll(wsRoot, "opencode", "global", true);

    // Local should remain
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "plugins", "fade.mjs")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(wsRoot, ".opencode", "command", "fade.md")),
    ).toBe(true);

    // Global should be removed
    expect(fs.existsSync(path.join(globalPluginsDir, "fade.mjs"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(globalCommandsDir, "fade.md"))).toBe(
      false,
    );
  });
});

describe("writeRuleFileWithConflict", () => {
  let tempDir: string;
  let ruleFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(
      path.join(require("os").tmpdir(), "rule-conflict-test-"),
    );
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  beforeEach(() => {
    ruleFile = path.join(tempDir, `rule-${Math.random()}.txt`);
  });

  afterEach(() => {
    if (fs.existsSync(ruleFile)) {
      fs.unlinkSync(ruleFile);
    }
  });

  test("writes content when file does not exist", () => {
    writeRuleFileWithConflict(ruleFile, "initial content", "skip");
    expect(fs.readFileSync(ruleFile, "utf-8")).toBe("initial content");
  });

  test("skips writing when file exists and action is skip", () => {
    fs.writeFileSync(ruleFile, "original", "utf-8");
    writeRuleFileWithConflict(ruleFile, "new content", "skip");
    expect(fs.readFileSync(ruleFile, "utf-8")).toBe("original");
  });

  test("overwrites when file exists and action is overwrite", () => {
    fs.writeFileSync(ruleFile, "original", "utf-8");
    writeRuleFileWithConflict(ruleFile, "new content", "overwrite");
    expect(fs.readFileSync(ruleFile, "utf-8")).toBe("new content");
  });

  test("appends when file exists and action is append", () => {
    fs.writeFileSync(ruleFile, "original", "utf-8");
    writeRuleFileWithConflict(ruleFile, "new content", "append");
    expect(fs.readFileSync(ruleFile, "utf-8")).toBe("original\n\nnew content");
  });

  test("skips append if content already exists", () => {
    fs.writeFileSync(ruleFile, "original\n\nnew content", "utf-8");
    writeRuleFileWithConflict(ruleFile, "new content", "append");
    expect(fs.readFileSync(ruleFile, "utf-8")).toBe("original\n\nnew content");
  });
});

describe("isInteractive", () => {
  let originalArgv: string[];
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    // Restore process.env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  test("returns false when CI env is set", () => {
    process.env.CI = "true";
    expect(isInteractive()).toBe(false);
  });

  test("returns false when BUN_TEST env is set", () => {
    process.env.BUN_TEST = "true";
    expect(isInteractive()).toBe(false);
  });

  test("returns false when argv contains --non-interactive", () => {
    delete process.env.CI;
    delete process.env.BUN_TEST;
    delete process.env.NODE_ENV;
    process.argv = ["bun", "src/cli/installer.ts", "--non-interactive"];
    expect(isInteractive()).toBe(false);
  });

  test("returns false when argv contains -y", () => {
    delete process.env.CI;
    delete process.env.BUN_TEST;
    delete process.env.NODE_ENV;
    process.argv = ["bun", "src/cli/installer.ts", "-y"];
    expect(isInteractive()).toBe(false);
  });

  test("returns true in normal interactive shell conditions", () => {
    delete process.env.CI;
    delete process.env.BUN_TEST;
    delete process.env.NODE_ENV;
    process.argv = ["bun", "src/cli/installer.ts"];
    expect(isInteractive()).toBe(true);
  });
});

describe("isRawTTY", () => {
  let originalArgv: string[];
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    // Restore process.env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  test("returns false when stdin is not a TTY", () => {
    const originalTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    try {
      expect(isRawTTY()).toBe(false);
    } finally {
      process.stdin.isTTY = originalTTY;
    }
  });

  test("returns false when stdout is not a TTY", () => {
    const originalTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    try {
      expect(isRawTTY()).toBe(false);
    } finally {
      process.stdout.isTTY = originalTTY;
    }
  });
});
