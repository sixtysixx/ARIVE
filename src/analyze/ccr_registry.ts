import { Database, Statement } from "bun:sqlite";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export class CCRRegistry {
  private db: Database;
  private insertStmt: Statement;
  private selectStmt: Statement;

  constructor(dbPath: string = ".arive/ccr_store.db") {
    const dir = path.dirname(dbPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      throw new Error(
        `Failed to create directory for CCR registry database at "${dir}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    try {
      this.db = new Database(dbPath);
    } catch (err) {
      throw new Error(
        `Failed to initialize CCR registry database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    try {
      this.db.run(
        "CREATE TABLE IF NOT EXISTS ccr_cache (hash TEXT PRIMARY KEY, content TEXT);"
      );
      this.insertStmt = this.db.prepare(
        "INSERT OR REPLACE INTO ccr_cache (hash, content) VALUES (?, ?);"
      );
      this.selectStmt = this.db.prepare(
        "SELECT content FROM ccr_cache WHERE hash = ?;"
      );
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  public store(content: string): string {
    const hash = "ccr:" + crypto.createHash("sha256").update(content).digest("hex");
    this.insertStmt.run(hash, content);
    return hash;
  }

  public retrieve(hash: string): string | null {
    const row = this.selectStmt.get(hash) as { content: string } | undefined;
    return row ? row.content : null;
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
