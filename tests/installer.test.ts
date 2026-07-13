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
import { installAll, writeRuleFileWithConflict } from "../src/cli/installer.js";

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
