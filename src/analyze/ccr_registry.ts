import { Database, Statement } from "bun:sqlite";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export class CCRRegistry {
  private db: Database;
  private insertStmt: Statement;
  private selectStmt: Statement;
  private maxItems: number;
  private itemCount: number = 0;
  constructor(dbPath: string = ".arive/ccr_store.db", maxItems: number = 1000) {
    this.maxItems = maxItems;
    const dir = path.dirname(dbPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      throw new Error(
        `Failed to create directory for CCR registry database at "${dir}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      this.db = new Database(dbPath);
    } catch (err) {
      throw new Error(
        `Failed to initialize CCR registry database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS ccr_cache (
          hash TEXT PRIMARY KEY, 
          content TEXT,
          content_type TEXT,
          original_size INTEGER,
          created_at TEXT,
          last_accessed TEXT
        );
      `);
      this.insertStmt = this.db.prepare(
        "INSERT OR REPLACE INTO ccr_cache (hash, content, content_type, original_size, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?);",
      );
      this.selectStmt = this.db.prepare(
        "SELECT content FROM ccr_cache WHERE hash = ?;",
      );
      this.updateAccessStmt = this.db.prepare(
        "UPDATE ccr_cache SET last_accessed = ? WHERE hash = ?;",
      );
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  private updateAccessStmt: Statement;

  public store(content: string, contentType: string = "unknown"): string {
    const hash =
      "ccr:" + crypto.createHash("sha256").update(content).digest("hex");
    const now = new Date().toISOString();
    this.insertStmt.run(hash, content, contentType, content.length, now, now);

    // Deferred pruning: only check when size exceeds threshold * 1.2
    this.itemCount = (this.itemCount || 0) + 1;
    if (this.itemCount > this.maxItems * 1.2) {
      this.prune(this.maxItems);
      this.itemCount = this.maxItems; // reset counter after prune
    }

    return hash;
  }

  public retrieve(hash: string): string | null {
    const row = this.selectStmt.get(hash) as { content: string } | undefined;
    if (row) {
      this.updateAccessStmt.run(new Date().toISOString(), hash);
      return row.content;
    }
    return null;
  }

  public prune(maxItems: number): void {
    const count = (
      this.db.query("SELECT COUNT(*) as count FROM ccr_cache").get() as any
    ).count;
    if (count > maxItems) {
      const toDelete = count - maxItems;
      this.db.run(
        `DELETE FROM ccr_cache WHERE hash IN (
          SELECT hash FROM ccr_cache ORDER BY last_accessed ASC LIMIT ?
        )`,
        [toDelete],
      );
    }
  }

  public clear(): void {
    this.db.run("DELETE FROM ccr_cache;");
  }

  public close(): void {
    try {
      this.insertStmt.finalize();
      this.selectStmt.finalize();
    } catch {
      // Ignore if statements already finalized or database closed
    }
    this.db.close();
  }
}
