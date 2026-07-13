// fallow-ignore-file unused-class-member
import { Database, Statement } from "bun:sqlite";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/* ------------------------------------------------------------------ */
/*  Data model                                                        */
/* ------------------------------------------------------------------ */

export interface MemoryEntry {
  drawerId: string;
  wing: string;
  room: string;
  hall: string;
  drawer: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

export type MemoryVerb =
  | "drawer_write"
  | "drawer_read"
  | "drawer_list"
  | "wing_create"
  | "room_create"
  | "hall_create"
  | "search"
  | "forget"
  | "recall"
  | "remember"
  | "stats";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .slice(0, 80);
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashContent(content: string, wing: string, room: string): string {
  return (
    "mem:" +
    crypto
      .createHash("sha256")
      .update(`${wing}\x00${room}\x00${content}`)
      .digest("hex")
      .slice(0, 16)
  );
}

function validateHierarchy(value: unknown, field: string): void {
  if (!value || typeof value !== "string" || /[;"'\x00]/.test(value)) {
    throw new Error(
      `Invalid "${field}": expected a plain non-empty string, got ${JSON.stringify(value)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Engine                                                             */
/* ------------------------------------------------------------------ */

/** SQLite row returned by the `drawers` table — cast is justified: we define the schema. */
interface DrawerRow {
  drawer_id: string;
  wing: string;
  room: string;
  hall: string;
  drawer: string;
  content: string;
  tags: string;
  metadata: string;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

/** Row returned by the `countAll` prepared statement. */
interface CountRow {
  c: number;
}

export class MemoryBank {
  private db: Database;
  private maxItems = 50_000;
  private stmts: {
    insert: Statement;
    select: Statement;
    updateAccess: Statement;
    delete: Statement;
    listByHall: Statement;
    search: Statement;
    countAll: Statement;
  };

  constructor(dbPath: string = ".arive/memory_bank.db", maxItems = 50_000) {
    const resolved = path.resolve(process.cwd(), dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.maxItems = maxItems;
    this.db = new Database(resolved);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS drawers (
        drawer_id     TEXT PRIMARY KEY,
        wing          TEXT NOT NULL,
        room          TEXT NOT NULL,
        hall          TEXT NOT NULL,
        drawer        TEXT NOT NULL DEFAULT '',
        content       TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        metadata      TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count  INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_drawers_wing ON drawers(wing);
      CREATE INDEX IF NOT EXISTS idx_drawers_room ON drawers(room);
      CREATE INDEX IF NOT EXISTS idx_drawers_hall ON drawers(hall);
      CREATE INDEX IF NOT EXISTS idx_drawers_created ON drawers(created_at);
    `);

    this.stmts = {
      insert: this.db.prepare(
        `INSERT INTO drawers
          (drawer_id, wing, room, hall, drawer, content, tags, metadata, created_at, last_accessed, access_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ),
      select: this.db.prepare(`SELECT * FROM drawers WHERE drawer_id = ?`),
      updateAccess: this.db.prepare(
        `UPDATE drawers SET last_accessed = ?, access_count = access_count + 1 WHERE drawer_id = ?`,
      ),
      delete: this.db.prepare(`DELETE FROM drawers WHERE drawer_id = ?`),
      listByHall: this.db.prepare(
        `SELECT * FROM drawers
          WHERE wing = ? AND room = ? AND hall = ?
          ORDER BY last_accessed DESC
          LIMIT ?`,
      ),
      search: this.db.prepare(
        `SELECT * FROM drawers
          WHERE wing LIKE ?
             OR room LIKE ?
             OR hall LIKE ?
             OR drawer LIKE ?
             OR content LIKE ?
             OR tags LIKE ?
          ORDER BY last_accessed DESC
          LIMIT ?`,
      ),
      countAll: this.db.prepare(`SELECT COUNT(*) as c FROM drawers`),
    };

    this.prune(maxItems);
  }

  /* -------------------------------------------------------------- */
  /*  CRUD                                                           */
  /* -------------------------------------------------------------- */

  write(args: {
    wing: string;
    room: string;
    hall: string;
    drawer?: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): MemoryEntry {
    validateHierarchy(args.wing, "wing");
    validateHierarchy(args.room, "room");
    validateHierarchy(args.hall, "hall");
    const content = String(args.content).trim();
    if (!content) {
      throw new Error("content must not be empty");
    }

    const drawerLabel = slugify(
      args.drawer && args.drawer.trim()
        ? args.drawer
        : "drawer-" + Date.now().toString(36),
    );
    const drawerId =
      hashContent(content, args.wing, args.room) + "-" + drawerLabel;
    const created = nowIso();

    this.stmts.insert.run(
      drawerId,
      args.wing,
      args.room,
      args.hall,
      drawerLabel,
      content,
      JSON.stringify(Array.isArray(args.tags) ? args.tags : []),
      JSON.stringify(args.metadata ?? {}),
      created,
      created,
    );

    this.prune(this.maxItems);

    return this.read(drawerId, false);
  }

  read(drawerId: string, bumpAccess = true): MemoryEntry {
    const row = this.stmts.select.get(drawerId);
    if (!row) {
      throw new Error(`Drawer not found: ${drawerId}`);
    }

    if (bumpAccess) {
      this.stmts.updateAccess.run(nowIso(), drawerId);
    }

    return this.rowToEntry(row, bumpAccess);
  }

  forget(drawerId: string): { removed: boolean } {
    const existing = this.stmts.select.get(drawerId);
    if (!existing) {
      return { removed: false };
    }
    this.stmts.delete.run(drawerId);
    return { removed: true };
  }

  list(wing: string, room: string, hall: string, limit = 50): MemoryEntry[] {
    return this.stmts.listByHall
      .all(wing, room, hall, limit)
      .map((row) => this.rowToEntry(row, false));
  }

  recall(query: string, limit = 50): MemoryEntry[] {
    const pattern = `%${query}%`;
    return this.stmts.search
      .all(pattern, pattern, pattern, pattern, pattern, pattern, limit)
      .map((row) => this.rowToEntry(row, false));
  }

  stats(): {
    totalDrawers: number;
    wings: number;
    rooms: number;
    halls: number;
  } {
    const { c } = this.stmts.countAll.get() as { c: number };
    const wingRows = this.db
      .prepare(`SELECT DISTINCT wing FROM drawers`)
      .all() as { wing: string }[];
    const roomRows = this.db
      .prepare(`SELECT DISTINCT wing, room FROM drawers`)
      .all() as { wing: string; room: string }[];
    const hallRows = this.db
      .prepare(`SELECT DISTINCT wing, room, hall FROM drawers`)
      .all() as { wing: string; room: string; hall: string }[];

    return {
      totalDrawers: c,
      wings: wingRows.length,
      rooms: roomRows.length,
      halls: hallRows.length,
    };
  }

  close(): void {
    this.db.close();
  }

  /* -------------------------------------------------------------- */
  /*  Internals                                                     */
  private rowToEntry(row: unknown, bumped: boolean): MemoryEntry {
    // Single justified cast: we own the schema and the row comes directly from our prepared statements.
    const r = row as DrawerRow;
    const tagsJson = r.tags || "[]";
    const metaJson = r.metadata || "{}";
    return {
      drawerId: r.drawer_id,
      wing: r.wing,
      room: r.room,
      hall: r.hall,
      drawer: r.drawer,
      content: r.content,
      tags: JSON.parse(tagsJson) as string[],
      metadata: JSON.parse(metaJson) as Record<string, unknown>,
      createdAt: r.created_at,
      lastAccessed: r.last_accessed,
      accessCount: bumped ? r.access_count + 1 : r.access_count,
    };
  }

  private prune(maxItems: number): void {
    // Single justified cast: we own the schema of countAll.
    const { c } = this.stmts.countAll.get() as CountRow;
    if (c > maxItems) {
      const excess = c - maxItems;
      this.db.run(
        `DELETE FROM drawers WHERE drawer_id IN (
           SELECT drawer_id FROM drawers
           ORDER BY last_accessed ASC, access_count ASC
           LIMIT ${excess}
         )`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Intent parser — recognises "remember to ..." and extracts args    */
export interface RememberIntent {
  wing: string;
  room: string;
  hall: string;
  drawer: string;
  content: string;
  tags: string[];
  /** 1 (trivial) – 10 (critical). Derived from urgency keywords in the content. */
  importance: number;
}

/**
 * Parses natural-language memory triggers into a structured RememberIntent.
 *
 * Trigger phrases recognised (case-insensitive):
 *   "remember to/that …"
 *   "please remember …"
 *   "don't forget to/that …"
 *   "keep in mind that …"
 *   "make a note that/of …"
 *   "note: …" / "note that …"
 *   "save this: …"
 *   "store this: …"
 *
 * Returns null when none of the patterns match or the extracted content is
 * too short to be meaningful (< 4 chars).
 */
export function parseRememberIntent(input: string): RememberIntent | null {
  const normalized = input.trim();
  if (!normalized) return null;

  const triggerPatterns: RegExp[] = [
    /^remember\s+to\s+(.+)$/is,
    /^remember\s+that\s+(.+)$/is,
    /^please\s+remember\s+(?:to\s+)?(.+)$/is,
    /^don'?t\s+forget\s+(?:to\s+|that\s+)?(.+)$/is,
    /^keep\s+in\s+mind\s+that\s+(.+)$/is,
    /^make\s+a\s+note\s+(?:that|of)\s+(.+)$/is,
    /^note[:\s]\s*(.+)$/is,
    /^save\s+(?:this|that|the\s+following)[:\s]\s*(.+)$/is,
    /^store\s+(?:this|that)[:\s]\s*(.+)$/is,
  ];

  let matched: RegExpMatchArray | null = null;
  for (const pattern of triggerPatterns) {
    matched = normalized.match(pattern);
    if (matched && matched[1]) break;
  }
  if (!matched || !matched[1]) return null;

  const content = matched[1].trim();
  if (content.length < 4) return null;

  // ---------- tag classification ----------
  const tags: string[] = ["user-memory"];

  if (
    /\b(preference|like|dislike|favor(?:ite)?|hate|love|prefer)\b/i.test(
      content,
    )
  )
    tags.push("preference");
  if (
    /\b(remind(?:er)?|todo|task|deadline|schedule|meeting|appointment|due)\b/i.test(
      content,
    )
  )
    tags.push("reminder");
  if (
    /\b(decided?|choice|chose|went\s+with|settled\s+on|picked|option)\b/i.test(
      content,
    )
  )
    tags.push("decision");
  if (
    /\b(fact|always|never|is\s+a|are\s+a|definition|means|equals)\b/i.test(
      content,
    )
  )
    tags.push("fact");
  if (
    /\b(found|discovered|learned|noticed|reali[sz]ed|insight)\b/i.test(content)
  )
    tags.push("discovery");
  if (
    /\b(rule|must|policy|constraint|requirement|should|standard)\b/i.test(
      content,
    )
  )
    tags.push("rule");

  // ---------- importance scoring ----------
  let importance = 5; // default mid-range
  if (
    /\b(urgent|critical|asap|immediately|emergency|blocker|p0)\b/i.test(content)
  )
    importance = 10;
  else if (
    /\b(important|high.?priority|must|required|essential|key)\b/i.test(content)
  )
    importance = 8;
  else if (
    /\b(nice.?to.?have|eventually|maybe|probably|if.?possible|low.?priority)\b/i.test(
      content,
    )
  )
    importance = 3;

  // ---------- hall routing ----------
  const primaryTag = tags.length > 1 ? tags[1] : "general";

  return {
    wing: "user-memories",
    room: "conversational",
    hall: primaryTag,
    drawer: "remember-" + Date.now().toString(36),
    content,
    tags,
    importance,
  };
}
