import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  optionalNumber,
  optionalString,
  requireString,
  textResult,
  type JsonObject,
  type LocalTool,
} from "../core/results.js";

interface DrawerRow {
  drawer_id: string;
  wing: string;
  room: string;
  hall: string;
  content: string;
  tags: string;
  importance: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

interface MemoryConfig {
  dbPath: string;
  maxItems: number;
}

/**
 * Escapes SQL LIKE wildcards so a query for "100%" matches a literal percent
 * sign instead of every drawer.
 */
function likePattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "general"
  );
}

export class MemoryStore {
  private readonly db: Database;
  private readonly maxItems: number;

  constructor(config: MemoryConfig) {
    const resolved = path.resolve(process.cwd(), config.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.maxItems = config.maxItems;
    this.db = new Database(resolved);
    this.db.run("PRAGMA journal_mode=WAL;");
    this.db.run("PRAGMA busy_timeout=5000;");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS drawers (
        drawer_id     TEXT PRIMARY KEY,
        wing          TEXT NOT NULL,
        room          TEXT NOT NULL,
        hall          TEXT NOT NULL,
        content       TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        importance    INTEGER NOT NULL DEFAULT 5,
        created_at    TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count  INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_drawers_wing ON drawers(wing);
      CREATE INDEX IF NOT EXISTS idx_drawers_room ON drawers(room);
      CREATE INDEX IF NOT EXISTS idx_drawers_hall ON drawers(hall);
    `);
    // A lowered memory.maxItems must take effect at startup, not at the next
    // write, or the store silently exceeds its own cap.
    this.prune();
  }

  write(input: {
    content: string;
    wing: string;
    room: string;
    hall: string;
    tags: string[];
    importance: number;
  }): JsonObject {
    const content = input.content.trim();
    if (!content) throw new Error("content must not be empty");
    if (content.length > 100_000)
      throw new Error("content exceeds 100k characters");

    const digest = createHash("sha256")
      .update(`${input.wing}\x00${input.room}\x00${content}`)
      .digest("hex")
      .slice(0, 16);
    const drawerId = `mem:${digest}`;
    const now = new Date().toISOString();
    const importance = Math.min(10, Math.max(1, Math.round(input.importance)));

    // A rewrite identifies the same drawer, so its tags accumulate instead of
    // being replaced by whatever the last caller happened to pass.
    const prior = this.db
      .prepare("SELECT tags FROM drawers WHERE drawer_id = ?")
      .get(drawerId) as { tags: string } | undefined;
    let priorTags: string[] = [];
    try {
      const parsed = JSON.parse(prior?.tags ?? "[]") as unknown;
      if (Array.isArray(parsed)) {
        priorTags = parsed.filter((tag): tag is string => typeof tag === "string");
      }
    } catch {
      priorTags = [];
    }
    const tags = [...new Set([...priorTags, ...input.tags])];

    this.db
      .prepare(
        `INSERT INTO drawers (drawer_id, wing, room, hall, content, tags, importance, created_at, last_accessed, access_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(drawer_id) DO UPDATE SET
           hall = excluded.hall,
           tags = excluded.tags,
           importance = excluded.importance,
           last_accessed = excluded.last_accessed,
           access_count = drawers.access_count + 1`,
      )
      .run(
        drawerId,
        input.wing,
        input.room,
        input.hall,
        content,
        JSON.stringify(tags),
        importance,
        now,
        now,
      );

    this.prune();
    return {
      status: "remembered",
      drawerId,
      wing: input.wing,
      room: input.room,
      hall: input.hall,
      importance,
    };
  }

  recall(query: {
    text?: string;
    wing?: string;
    room?: string;
    hall?: string;
    limit: number;
  }): JsonObject[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (query.text) {
      clauses.push(
        "(content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR wing LIKE ? ESCAPE '\\' OR room LIKE ? ESCAPE '\\')",
      );
      const pattern = likePattern(query.text);
      params.push(pattern, pattern, pattern, pattern);
    }
    if (query.wing) {
      clauses.push("wing = ?");
      params.push(query.wing);
    }
    if (query.room) {
      clauses.push("room = ?");
      params.push(query.room);
    }
    if (query.hall) {
      clauses.push("hall = ?");
      params.push(query.hall);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(query.limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM drawers ${where} ORDER BY last_accessed DESC, importance DESC LIMIT ?`,
      )
      .all(...params) as DrawerRow[];

    if (rows.length === 0) return [];

    // A recall is an access: keep recency ordering and usage counts honest.
    // RETURNING reports the rows that were actually written, so the counters
    // in the response cannot drift from the stored ones.
    const now = new Date().toISOString();
    const placeholders = rows.map(() => "?").join(",");
    const updated = this.db
      .prepare(
        `UPDATE drawers SET last_accessed = ?, access_count = access_count + 1
         WHERE drawer_id IN (${placeholders}) RETURNING *`,
      )
      .all(now, ...rows.map((row) => row.drawer_id)) as DrawerRow[];

    const byId = new Map(updated.map((row) => [row.drawer_id, row]));
    return rows
      .map((row) => byId.get(row.drawer_id))
      .filter((row): row is DrawerRow => row !== undefined)
      .map((row) => this.toEntry(row));
  }

  forget(drawerId: string): JsonObject {
    const existing = this.db
      .prepare("SELECT drawer_id FROM drawers WHERE drawer_id = ?")
      .get(drawerId);
    if (!existing) return { removed: false, drawerId };
    this.db.prepare("DELETE FROM drawers WHERE drawer_id = ?").run(drawerId);
    return { removed: true, drawerId };
  }

  stats(): JsonObject {
    const total = (
      this.db.prepare("SELECT COUNT(*) AS c FROM drawers").get() as {
        c: number;
      }
    ).c;
    const wings = (
      this.db
        .prepare("SELECT COUNT(DISTINCT wing) AS c FROM drawers")
        .get() as { c: number }
    ).c;
    const rooms = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS c FROM (SELECT DISTINCT wing, room FROM drawers)",
        )
        .get() as { c: number }
    ).c;
    const halls = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS c FROM (SELECT DISTINCT wing, room, hall FROM drawers)",
        )
        .get() as { c: number }
    ).c;
    return {
      totalDrawers: total,
      wings,
      rooms,
      halls,
      maxItems: this.maxItems,
    };
  }

  close(): void {
    this.db.close();
  }

  private toEntry(row: DrawerRow): JsonObject {
    let tags: unknown = [];
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }
    return {
      drawerId: row.drawer_id,
      wing: row.wing,
      room: row.room,
      hall: row.hall,
      content: row.content,
      tags,
      importance: row.importance,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };
  }

  private prune(): void {
    const total = (
      this.db.prepare("SELECT COUNT(*) AS c FROM drawers").get() as {
        c: number;
      }
    ).c;
    if (total <= this.maxItems) return;
    this.db
      .prepare(
        `DELETE FROM drawers WHERE drawer_id IN (
           SELECT drawer_id FROM drawers ORDER BY last_accessed ASC, importance ASC LIMIT ?
         )`,
      )
      .run(total - this.maxItems);
  }
}

export function createMemoryTools(store: MemoryStore): LocalTool[] {
  return [
    {
      name: "mem_remember",
      description:
        "[MEM] Store a durable fact, decision, or finding in the spatial memory hierarchy (wing/room/hall). Idempotent per (wing, room, content); re-writing the same drawer merges tags and updates hall/importance.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          wing: { type: "string", default: "codebase" },
          room: { type: "string", default: "general" },
          hall: {
            type: "string",
            description: "facts | decisions | findings | preferences | rules",
            default: "facts",
          },
          tags: { type: "array", items: { type: "string" } },
          importance: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        },
        required: ["content"],
      },
      handler: (args) => {
        const content = requireString(args, "content", "mem_remember");
        const tags = Array.isArray(args.tags)
          ? args.tags.filter((t): t is string => typeof t === "string")
          : [];
        return textResult(
          store.write({
            content,
            wing: slug(optionalString(args, "wing") ?? "codebase"),
            room: slug(optionalString(args, "room") ?? "general"),
            hall: slug(optionalString(args, "hall") ?? "facts"),
            tags,
            importance: optionalNumber(args, "importance") ?? 5,
          }),
        );
      },
    },
    {
      name: "mem_recall",
      description:
        "[MEM] Search the memory hierarchy by free text and/or wing, room, hall. Returns the most recently accessed matches.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          wing: { type: "string" },
          room: { type: "string" },
          hall: { type: "string" },
          limit: { type: "integer", default: 20 },
        },
      },
      handler: (args) => {
        const limit = Math.min(
          100,
          Math.max(1, optionalNumber(args, "limit") ?? 20),
        );
        const wing = optionalString(args, "wing");
        const room = optionalString(args, "room");
        const hall = optionalString(args, "hall");
        const results = store.recall({
          text: optionalString(args, "query"),
          wing: wing ? slug(wing) : undefined,
          room: room ? slug(room) : undefined,
          hall: hall ? slug(hall) : undefined,
          limit,
        });
        return textResult({ count: results.length, results });
      },
    },
    {
      name: "mem_forget",
      description: "[MEM] Delete a drawer by id.",
      inputSchema: {
        type: "object",
        properties: { drawerId: { type: "string" } },
        required: ["drawerId"],
      },
      handler: (args) => {
        const drawerId = requireString(args, "drawerId", "mem_forget");
        return textResult(store.forget(drawerId));
      },
    },
    {
      name: "mem_stats",
      description: "[MEM] Report drawer, wing, room, and hall counts.",
      inputSchema: { type: "object", properties: {} },
      handler: () => textResult(store.stats()),
    },
  ];
}
