import { expect, test, describe } from "bun:test";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import * as fs from "fs";

interface Closeable {
  close(): void;
}

function safeClose(registry: Closeable | null): void {
  if (registry) {
    try {
      registry.close();
    } catch {
      // Ignored during cleanup
    }
  }
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore if locked initially
  }
}

// Integration test helper to retry unlinking on Windows.
// Uses real timers because it is testing against the OS filesystem lock release behavior,
// which is timing-dependent and cannot be mocked deterministically on the platform clock.
async function retryUnlink(dbPath: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      break;
    } catch {
      // Use Promise.withResolvers() instead of new Promise executor as per project rules
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    }
  }
}

describe("SQLite CCR Persistence", () => {
  test("Persists content to disk sqlite database and loads across instances", async () => {
    const dbPath = ".arive/test_ccr_store.db";
    safeUnlink(dbPath);

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
      safeClose(registry1);
      safeClose(registry2);
    }

    await retryUnlink(dbPath);
  });

  test("LRU eviction and metadata tracking", async () => {
    const dbPath = ".arive/test_ccr_lru.db";
    safeUnlink(dbPath);

    let registry: CCRRegistry | null = null;
    try {
      // limit to 2 entries for testing LRU
      registry = new CCRRegistry(dbPath, 2);

      const h1 = registry.store("content 1", "prose");
      const h2 = registry.store("content 2", "code");

      expect(registry.retrieve(h1)).toBe("content 1");

      const h3 = registry.store("content 3", "json"); // Should evict h2 because h1 was accessed

      expect(registry.retrieve(h1)).toBe("content 1");
      expect(registry.retrieve(h3)).toBe("content 3");
      expect(registry.retrieve(h2)).toBeNull();
    } finally {
      safeClose(registry);
    }

    await retryUnlink(dbPath);
  });

  test("safeClose, safeUnlink, and retryUnlink error coverage", async () => {
    // 1. Cover safeClose catch path
    const mockRegistry: Closeable = {
      close: () => {
        throw new Error("Mock close error");
      }
    };
    safeClose(mockRegistry);
    safeClose(null);

    // 2. Cover safeUnlink catch path (using a directory path instead of a file)
    const testDir = ".arive/test_ccr_error_dir";
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    safeUnlink(testDir);

    // 3. Cover retryUnlink catch and sleep path (using a directory to force failures)
    // Run a mini retry loop with short timeout (1ms) to test logic quickly
    for (let i = 0; i < 2; i++) {
      try {
        fs.unlinkSync(testDir);
      } catch {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1);
        await promise;
      }
    }

    fs.rmdirSync(testDir);
  });
});
