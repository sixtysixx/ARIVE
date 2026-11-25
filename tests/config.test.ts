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
  test("defaults cover every spawnable namespace exactly once", () => {
    const config = defaultConfig();
    const spawnable = NAMESPACES.filter((namespace) => namespace !== "fable");
    const namespaces = config.downstreams.map((d) => d.namespace).sort();
    expect(namespaces).toEqual([...spawnable].sort());
    expect(new Set(namespaces).size).toBe(spawnable.length);
  });

  test("defaults spawn only the four real MCP servers", () => {
    const enabled = defaultConfig()
      .downstreams.filter((d) => d.enabled)
      .map((d) => d.namespace)
      .sort();
    expect(enabled).toEqual(["dap", "lh", "lsp", "think"]);
  });

  test("the long-horizon server is pinned and enabled by default", () => {
    const lh = defaultConfig().downstreams.find((d) => d.namespace === "lh");
    expect(lh?.enabled).toBe(true);
    expect(lh?.command).toBe("uvx");
    expect(lh?.args).toContain(
      "git+https://github.com/AMAP-ML/LongHorizon-Harness@634030370a9d41ac1c1c6ea7c07bc96ca1d24462",
    );
    expect(lh?.args).toContain("mcp-server");
    expect(lh?.compress).toBe(false);
  });

  test("rejects a downstream override for an in-process namespace", () => {
    expect(() =>
      mergeConfig({ downstreams: [{ namespace: "fable", enabled: true }] }),
    ).toThrow(/served in-process/);
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
    expect(config.downstreams).toHaveLength(NAMESPACES.length - 1);
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

  test("fails loudly on a missing explicit config file", () => {
    const missing = path.join(os.tmpdir(), "arive-missing-config.json");
    expect(() => loadConfig(missing)).toThrow(/Config file not found/);
  });

  test("fails loudly on a missing ARIVE_CONFIG file", () => {
    process.env.ARIVE_CONFIG = path.join(
      os.tmpdir(),
      "arive-missing-env-config.json",
    );
    expect(() => loadConfig()).toThrow(/Config file not found/);
  });

  test("rejects numeric settings that cannot work", () => {
    expect(() =>
      loadConfig(writeConfig({ compression: { maxEntries: 0 } })),
    ).toThrow(/maxEntries/);
    expect(() =>
      loadConfig(writeConfig({ compression: { previewChars: -1 } })),
    ).toThrow(/previewChars/);
    expect(() => loadConfig(writeConfig({ memory: { maxItems: 0 } }))).toThrow(
      /maxItems/,
    );
    expect(() => loadConfig(writeConfig({ search: { maxResults: 0 } }))).toThrow(
      /maxResults/,
    );
  });

  test("rag defaults are offline and fully populated", () => {
    const rag = defaultConfig().rag;
    expect(rag.embeddings.provider).toBe("none");
    expect(rag.chunkChars).toBe(1200);
    expect(rag.maxTopK).toBeGreaterThanOrEqual(rag.defaultTopK);
  });

  test("merges a partial rag override without dropping other rag defaults", () => {
    const config = mergeConfig({ rag: { chunkChars: 2000, maxTopK: 20 } });
    expect(config.rag.chunkChars).toBe(2000);
    expect(config.rag.maxTopK).toBe(20);
    expect(config.rag.chunkOverlapChars).toBe(200);
    expect(config.rag.embeddings.provider).toBe("none");

    const withProvider = mergeConfig({
      rag: { embeddings: { provider: "ollama", model: "nomic-embed-text" } },
    });
    expect(withProvider.rag.embeddings.provider).toBe("ollama");
    expect(withProvider.rag.embeddings.model).toBe("nomic-embed-text");
    expect(withProvider.rag.embeddings.batchSize).toBe(32);
  });

  test("rejects an unknown embedding provider", () => {
    expect(() =>
      mergeConfig({ rag: { embeddings: { provider: "cohere" } } }),
    ).toThrow(/rag\.embeddings\.provider "cohere"/);
  });

  test("ARIVE_RAG_DB overrides the rag database path", () => {
    process.env.ARIVE_RAG_DB = path.join(os.tmpdir(), "custom-rag.db");
    const config = loadConfig(writeConfig({}));
    expect(config.rag.dbPath).toBe(process.env.ARIVE_RAG_DB);
  });

  test("rejects rag settings that cannot work", () => {
    expect(() =>
      loadConfig(
        writeConfig({ rag: { chunkChars: 200, chunkOverlapChars: 200 } }),
      ),
    ).toThrow(/chunkOverlapChars/);
    expect(() =>
      loadConfig(writeConfig({ rag: { defaultTopK: 20, maxTopK: 10 } })),
    ).toThrow(/maxTopK/);
    expect(() => loadConfig(writeConfig({ rag: { maxPerFile: 0 } }))).toThrow(
      /maxPerFile/,
    );
  });
});
