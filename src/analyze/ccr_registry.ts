import { Database } from "bun:sqlite";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export class CCRRegistry {
  private db: Database;

  constructor(dbPath: string = ".arive/ccr_store.db") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.run(
      "CREATE TABLE IF NOT EXISTS ccr_cache (hash TEXT PRIMARY KEY, content TEXT);"
    );
  }

  public store(content: string): string {
    const hash = "ccr:" + crypto.createHash("sha256").update(content).digest("hex");
    const query = this.db.prepare("INSERT OR REPLACE INTO ccr_cache (hash, content) VALUES (?, ?);");
    query.run(hash, content);
    return hash;
  }

  public retrieve(hash: string): string | null {
    const query = this.db.prepare("SELECT content FROM ccr_cache WHERE hash = ?;");
    const row = query.get(hash) as { content: string } | undefined;
    return row ? row.content : null;
  }

  public clear(): void {
    this.db.run("DELETE FROM ccr_cache;");
  }

  public close(): void {
    this.db.close();
  }
}
