import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import * as fs from "fs";

describe("CCR Registry Tests", () => {
  const dbPath = ".arive/test_ccr_store.json";
  
  beforeAll(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterAll(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  test("Store and retrieve contents", () => {
    const registry = new CCRRegistry(dbPath);
    const content = "Hello World Raw Content";
    const hash = registry.store(content);
    expect(hash).toBe("ccr:937630995fc998f52ffe7a11052783202b01ec5c8a3fdfed83fa591acd7a15f8");
    
    const retrieved = registry.retrieve(hash);
    expect(retrieved).toBe(content);
  });

  test("Returns null/undefined for missing hashes", () => {
    const registry = new CCRRegistry(dbPath);
    expect(registry.retrieve("ccr:missing")).toBeUndefined();
  });
});
