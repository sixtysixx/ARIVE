import { expect, test, describe } from "bun:test";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import * as fs from "fs";

describe("SQLite CCR Persistence", () => {
  test("Persists content to disk sqlite database and loads across instances", async () => {
    const dbPath = ".arive/test_ccr_store.db";
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // Ignore if locked initially
      }
    }

    let registry1: CCRRegistry | null = null;
    let registry2: CCRRegistry | null = null;

    try {
      registry1 = new CCRRegistry(dbPath);
      const content = "persistent sqlite cached content block example";
      const hash = registry1.store(content);
      registry1.close();
      registry1 = null;

      registry2 = new CCRRegistry(dbPath);
      const retrieved = registry2.retrieve(hash);
      expect(retrieved).toBe(content);
      registry2.close();
      registry2 = null;
    } finally {
      if (registry1) {
        try {
          registry1.close();
        } catch {
          // Ignored during cleanup
        }
      }
      if (registry2) {
        try {
          registry2.close();
        } catch {
          // Ignored during cleanup
        }
      }
    }

    // Retry loop for unlinking on Windows to handle asynchronous resource release
    for (let i = 0; i < 20; i++) {
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });
});
