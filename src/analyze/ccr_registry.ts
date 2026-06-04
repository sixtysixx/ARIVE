import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

export class CCRRegistry {
  private dbPath: string;
  private storeMap: Record<string, string> = {};

  constructor(dbPath = ".arive/ccr_store.json") {
    this.dbPath = dbPath;
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const fileContent = fs.readFileSync(this.dbPath, "utf-8");
        this.storeMap = JSON.parse(fileContent);
      }
    } catch (e) {
      this.storeMap = {};
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.storeMap, null, 2), "utf-8");
    } catch (e) {
      // Silent save failure
    }
  }

  public store(content: string): string {
    const sha = createHash("sha256").update(content).digest("hex");
    const key = `ccr:${sha}`;
    this.storeMap[key] = content;
    this.save();
    return key;
  }

  public retrieve(hash: string): string | undefined {
    return this.storeMap[hash];
  }
}
