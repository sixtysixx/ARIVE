import { describe, test, expect, beforeEach } from "bun:test";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import * as fs from "fs";
import * as path from "path";

describe("SequentialEngine SQLite", () => {
  const dbPath = ".arive/test_thinking.db";

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  test("should persist thoughts across sessions using sessionId", () => {
    const engine = new SequentialEngine(dbPath);
    engine.addThought(
      "test thought",
      1,
      1,
      false,
      undefined,
      undefined,
      undefined,
      "session-123",
    );
    engine.close();

    const engine2 = new SequentialEngine(dbPath);
    const state = engine2.getState("session-123");
    expect(state.history.length).toBe(1);
    expect(state.history[0].thought).toBe("test thought");
    engine2.close();
  });

  test("should isolate thoughts by sessionId", () => {
    const engine = new SequentialEngine(dbPath);
    engine.addThought(
      "thought 1",
      1,
      1,
      false,
      undefined,
      undefined,
      undefined,
      "session-1",
    );
    engine.addThought(
      "thought 2",
      1,
      1,
      false,
      undefined,
      undefined,
      undefined,
      "session-2",
    );

    const state1 = engine.getState("session-1");
    const state2 = engine.getState("session-2");

    expect(state1.history.length).toBe(1);
    expect(state1.history[0].thought).toBe("thought 1");
    expect(state2.history.length).toBe(1);
    expect(state2.history[0].thought).toBe("thought 2");
    engine.close();
  });
});
