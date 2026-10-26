import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { defaultConfig } from "../src/core/config.js";
import { VERSION } from "../src/core/version.js";

const root = path.join(import.meta.dir, "..");

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

describe("version", () => {
  test("package.json, VERSION, default config, and the example agree", () => {
    const pkg = readJson("package.json") as { version: string };
    const example = readJson("arive.config.example.json") as {
      server: { version: string };
    };

    expect(pkg.version).toBe(VERSION);
    expect(defaultConfig().server.version).toBe(VERSION);
    expect(example.server.version).toBe(VERSION);
  });
});
