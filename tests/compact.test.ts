import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import { createCompactHelpers } from "../src/mcp/compact.js";
import * as fs from "fs";

describe("Compact Helpers", () => {
  const dbPath = ".arive/test_compact.db";
  let registry: CCRRegistry;

  beforeAll(() => {
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore
      }
    }
    registry = new CCRRegistry(dbPath);
  });

  afterAll(async () => {
    registry.close();
    // Clean up DB safely
    for (let i = 0; i < 20; i++) {
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }
        break;
      } catch {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
    }
  });

  test("compactText returns original text if under threshold", () => {
    const helpers = createCompactHelpers(registry);
    const result = helpers.compactText("short text", "test", {}, 100);
    expect(result).toBe("short text");
  });

  test("compactText stores content in registry and returns hash if over threshold", () => {
    const helpers = createCompactHelpers(registry);
    const longText = "a".repeat(150);
    const result = helpers.compactText(longText, "test", { type: "code" }, 100);
    
    expect(result.startsWith("ccr:")).toBe(true);
    const hash = result.substring(4);
    const retrieved = registry.retrieve(hash);
    expect(retrieved).toBe(longText);
  });

  test("compactObject returns original object if JSON representation under threshold", () => {
    const helpers = createCompactHelpers(registry);
    const shortObj = { msg: "hello" };
    const res = helpers.compactObject(shortObj, "test", {}, 1000);
    
    expect(res.compacted).toBe(false);
    expect(res.value).toEqual(shortObj);
    expect(res.originalLength).toBe(JSON.stringify(shortObj).length);
  });

  test("compactObject stores JSON representation and returns ref if over threshold", () => {
    const helpers = createCompactHelpers(registry);
    const longObj = { data: "a".repeat(150) };
    const res = helpers.compactObject(longObj, "test", {}, 50);
    
    expect(res.compacted).toBe(true);
    expect(res.ref?.startsWith("ccr:")).toBe(true);
    
    const hash = res.ref!.substring(4);
    const retrieved = registry.retrieve(hash);
    expect(retrieved).not.toBeNull();
    
    const parsedObj = JSON.parse(retrieved!) as typeof longObj;
    expect(parsedObj).toEqual(longObj);
  });
});
