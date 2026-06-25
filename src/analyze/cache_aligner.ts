export class CacheAligner {
  public static align(content: string): string {
    return content
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }
}
