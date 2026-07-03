import { expect, test, describe } from "bun:test";
import { MemoryBank, parseRememberIntent } from "../src/reason/memory_bank.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("MemoryBank", () => {
  test("writes and reads a drawer", () => {
    const dbPath =
      fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
    const bank = new MemoryBank(dbPath);
    const entry = bank.write({
      wing: "work",
      room: "project-alpha",
      hall: "decisions",
      drawer: "chosen-stack",
      content: "We will use Bun for the backend.",
      tags: ["decision", "architecture"],
      metadata: { priority: 1 },
    });

    expect(entry.wing).toBe("work");
    expect(entry.room).toBe("project-alpha");
    expect(entry.hall).toBe("decisions");
    expect(entry.content).toBe("We will use Bun for the backend.");
    expect(entry.tags).toEqual(["decision", "architecture"]);
    expect(entry.metadata).toEqual({ priority: 1 });
    expect(entry.accessCount).toBe(1);

    const read = bank.read(entry.drawerId);
    expect(read.content).toBe(entry.content);
    expect(read.accessCount).toBe(2);
    bank.close();
  });

  test("lists drawers by hierarchy", () => {
    const dbPath =
      fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
    const bank = new MemoryBank(dbPath);
    bank.write({ wing: "w", room: "r", hall: "h", content: "alpha" });
    bank.write({ wing: "w", room: "r", hall: "h", content: "beta" });
    bank.write({ wing: "w", room: "r", hall: "other", content: "gamma" });
    bank.write({ wing: "w", room: "other", hall: "h", content: "delta" });

    const list = bank.list("w", "r", "h", 10);
    expect(list.length).toBe(2);
    expect(list.map((e) => e.content).sort()).toEqual(["alpha", "beta"]);
    bank.close();
  });

  test("recalls by query", () => {
    const dbPath =
      fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
    const bank = new MemoryBank(dbPath);
    bank.write({
      wing: "w1",
      room: "r1",
      hall: "h1",
      content: "the quick brown fox",
    });
    bank.write({ wing: "w2", room: "r2", hall: "h2", content: "the lazy dog" });
    bank.write({
      wing: "w3",
      room: "r3",
      hall: "h3",
      content: "another fox jumps",
    });

    expect(bank.recall("fox").length).toBe(2);
    expect(bank.recall("zzzz-no-match").length).toBe(0);
    bank.close();
  });

  test("forgets a drawer", () => {
    const dbPath =
      fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
    const bank = new MemoryBank(dbPath);
    const entry = bank.write({
      wing: "w",
      room: "r",
      hall: "h",
      content: "to forget",
    });
    expect(bank.forget(entry.drawerId).removed).toBe(true);
    expect(bank.forget(entry.drawerId).removed).toBe(false);
    bank.close();
  });

  test("stats reflects hierarchy", () => {
    const dbPath =
      fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
    const bank = new MemoryBank(dbPath);
    bank.write({ wing: "a", room: "r1", hall: "h1", content: "1" });
    bank.write({ wing: "a", room: "r1", hall: "h2", content: "2" });
    bank.write({ wing: "a", room: "r2", hall: "h1", content: "3" });
    bank.write({ wing: "b", room: "r1", hall: "h1", content: "4" });

    const stats = bank.stats();
    expect(stats.totalDrawers).toBe(4);
    expect(stats.wings).toBe(2);
    expect(stats.rooms).toBe(3);
    expect(stats.halls).toBeGreaterThanOrEqual(3);
    bank.close();
  });
});

describe("parseRememberIntent", () => {
  test.each([
    ["remember to buy milk", "buy milk", ["user-memory"]],
    ["remember that Python wins", "Python wins", ["user-memory"]],
    [
      "please remember to submit the PR by Friday",
      "submit the PR by Friday",
      ["user-memory"],
    ],
    [
      "save this: the design review is at 3pm",
      "the design review is at 3pm",
      ["user-memory"],
    ],
    ["I love dark mode", null, []],
    [
      "remember to remind Dave about the deadline",
      "remind Dave about the deadline",
      ["user-memory", "reminder"],
    ],
    [
      "remember that blue is the best color",
      "blue is the best color",
      ["user-memory"],
    ],
  ])("parses '%s'", (input, expectedContent, expectedTags) => {
    const result = parseRememberIntent(input);
    if (expectedContent === null) {
      expect(result).toBeNull();
    } else {
      expect(result?.content).toBe(expectedContent);
      expect(result?.tags).toEqual(expectedTags);
    }
  });
});

test("MemoryBank handles maxItems prune", () => {
  const dbPath =
    fs.mkdtempSync(path.join(os.tmpdir(), "mem-bank-")) + "/test.db";
  const bank = new MemoryBank(dbPath, 10);
  for (let i = 0; i < 20; i++) {
    bank.write({ wing: "w", room: "r", hall: "h", content: `item-${i}` });
  }
  const stats = bank.stats();
  expect(stats.totalDrawers).toBeLessThanOrEqual(10);
  bank.close();
});
