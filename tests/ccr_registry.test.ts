import { expect, test, describe } from "bun:test";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import * as fs from "fs";

describe("SQLite CCR Persistence", () => {
  test("Persists content to disk sqlite database and loads across instances", async () => {
    const dbPath = ".arive/test_ccr_store.db";
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {
        // Ignore if locked initially
      }
    }

    const registry1 = new CCRRegistry(dbPath);
    const content = "persistent sqlite cached content block example";
    const hash = registry1.store(content);
    registry1.close();

    const registry2 = new CCRRegistry(dbPath);
    const retrieved = registry2.retrieve(hash);
    expect(retrieved).toBe(content);
    registry2.close();

    // Retry loop for unlinking on Windows to handle asynchronous resource release
    for (let i = 0; i < 20; i++) {
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }
        break;
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });
});
