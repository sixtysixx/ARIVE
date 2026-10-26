import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  defaultConfig,
  loadConfig,
  mergeConfig,
  NAMESPACES,
} from "../src/core/config.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("ARIVE_")) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value !== undefined) process.env[key] = value;
  }
});

function writeConfig(raw: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-config-"));
  const file = path.join(dir, "arive.config.json");
  fs.writeFileSync(file, JSON.stringify(raw));
  return file;
}

describe("config", () => {
  test("defaults cover all six namespaces exactly once", () => {
    const config = defaultConfig();
    const namespaces = config.downstreams.map((d) => d.namespace).sort();
    expect(namespaces).toEqual([...NAMESPACES].sort());
    expect(new Set(namespaces).size).toBe(6);
  });

  test("defaults spawn only the three real MCP servers", () => {
    const enabled = defaultConfig()
      .downstreams.filter((d) => d.enabled)
      .map((d) => d.namespace)
      .sort();
    expect(enabled).toEqual(["dap", "lsp", "think"]);
  });

  test("merges a downstream override without dropping the others", () => {
    const config = mergeConfig({
      downstreams: [
        {
          namespace: "search",
          enabled: true,
          command: "custom-search",
          args: ["--stdio"],
        },
      ],
    });
    expect(config.downstreams).toHaveLength(6);
    const search = config.downstreams.find((d) => d.namespace === "search");
    expect(search?.enabled).toBe(true);
    expect(search?.command).toBe("custom-search");
    expect(search?.args).toEqual(["--stdio"]);
  });

  test("rejects unknown namespaces", () => {
    expect(() =>
      mergeConfig({ downstreams: [{ namespace: "nope", enabled: true }] }),
    ).toThrow(/namespace/);
  });

  test("rejects an enabled downstream without a command", () => {
    const file = writeConfig({
      downstreams: [{ namespace: "think", enabled: true, command: " " }],
    });
    expect(() => loadConfig(file)).toThrow(/no command/);
  });

  test("loads thresholds from a file", () => {
    const file = writeConfig({ compression: { thresholdTokens: 1234 } });
    const config = loadConfig(file);
    expect(config.compression.thresholdTokens).toBe(1234);
  });

  test("ARIVE_DISABLE turns namespaces off", () => {
    process.env.ARIVE_DISABLE = "think,lsp";
    const config = loadConfig(writeConfig({}));
    const enabled = config.downstreams
      .filter((d) => d.enabled)
      .map((d) => d.namespace);
    expect(enabled).not.toContain("think");
    expect(enabled).not.toContain("lsp");
    expect(enabled).toContain("dap");
  });

  test("ARIVE_COMPRESS=0 disables compression", () => {
    process.env.ARIVE_COMPRESS = "0";
    expect(loadConfig(writeConfig({})).compression.enabled).toBe(false);
  });
});
