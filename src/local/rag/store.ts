import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RagConfig } from "../../core/config.js";
import { runCommand } from "../../core/exec.js";
import { errorMessage } from "../../core/log.js";
import type { JsonObject } from "../../core/results.js";
import { chunkText, extractIdentifiers, hasLongLine } from "./chunker.js";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
import { dot, fromBlob, toBlob, vectorLength } from "./vectors.js";

export interface IndexArgs {
  path?: string;
  glob?: string;
  force?: boolean;
  embed?: boolean;
  maxFiles?: number;
}

export interface QueryArgs {
  query: string;
  topK?: number;
  path?: string;
  maxChars?: number;
}

interface FileRow {
  path: string;
  mtime_ms: number;
  size: number;
  sha256: string;
}

interface ChunkRow {
  id: number;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  embedding?: Uint8Array | null;
}

interface LexicalRow extends ChunkRow {
  bm25_score: number;
}

interface Hit {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  lexicalScore?: number;
  vectorScore?: number;
}

/** Signals a configuration problem that must not be retried per chunk. */
class EmbeddingDimensionError extends Error {}

/** Escapes SQL LIKE wildcards so a literal `%` or `_` in a path stays literal. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Stored paths are absolute; citations are workspace-relative when possible. */
function displayPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    return abs;
  }
  return rel;
}

/**
 * Turns free text into an FTS5 query of quoted prefix terms. Every token is
 * escaped, so operators and quotes typed by a user can never break the MATCH.
 */
function buildFtsQuery(query: string): string {
  const tokens = query.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^_+|_+$/g, "");
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    terms.push(`"${token.replace(/"/g, '""')}"${token.length >= 4 ? "*" : ""}`);
  }
  return terms.join(" OR ");
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function isBinary(text: string): boolean {
  return text.slice(0, 8192).includes("\u0000");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rag_files (
    path TEXT PRIMARY KEY,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rag_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    text TEXT NOT NULL,
    ident TEXT NOT NULL,
    embedding BLOB,
    embedding_id TEXT,
    indexed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_path ON rag_chunks(path);
  CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
    body, ident,
    tokenize = 'unicode61 remove_diacritics 2 tokenchars _'
  );
  CREATE TABLE IF NOT EXISTS rag_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export class RagStore {
  private readonly db: Database;
  private readonly config: RagConfig;
  private readonly provider: EmbeddingProvider | undefined;
  private indexing = false;

  constructor(config: RagConfig, provider?: EmbeddingProvider) {
    const resolved = path.resolve(process.cwd(), config.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.config = config;
    this.provider = provider ?? createEmbeddingProvider(config.embeddings);
    this.db = new Database(resolved);
    this.db.run("PRAGMA journal_mode=WAL;");
    this.db.run("PRAGMA busy_timeout=5000;");
    try {
      this.db.run(SCHEMA);
    } catch (error) {
      this.db.close();
      throw new Error(
        `RAG index requires SQLite FTS5 support: ${errorMessage(error)}`,
      );
    }
  }

  async index(args: IndexArgs): Promise<JsonObject> {
    if (this.indexing) throw new Error("A rag_index call is already running.");
    this.indexing = true;
    try {
      return await this.runIndex(args);
    } finally {
      this.indexing = false;
    }
  }

  private async runIndex(args: IndexArgs): Promise<JsonObject> {
    const started = Date.now();
    const root = path.resolve(process.cwd(), args.path ?? ".");
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(root);
    } catch {
      throw new Error(`Path not found: ${root}`);
    }
    const isDirectory = rootStat.isDirectory();
    const force = args.force ?? false;
    const embed = args.embed !== false;

    await this.ensureEmbeddingCompatibility(force);

    const cap = Math.max(
      1,
      Math.min(args.maxFiles ?? this.config.maxFiles, this.config.maxFiles),
    );
    const enumeration = await this.enumerate(root, isDirectory, args.glob, cap);

    const counts = {
      scanned: 0,
      indexed: 0,
      unchanged: 0,
      skipped: 0,
      removed: 0,
    };
    let chunksAdded = 0;
    let embedded = 0;
    let failed = 0;
    let embedError: string | undefined;

    const now = (): string => new Date().toISOString();

    for (const abs of enumeration.files) {
      counts.scanned += 1;
      // Indexing is synchronous work over a whole tree; without a yield, every
      // other in-flight MCP request waits for the walk to finish.
      if (counts.scanned % 25 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        counts.skipped += 1;
        continue;
      }
      if (!stat.isFile() || stat.size > this.config.maxFileBytes) {
        counts.skipped += 1;
        continue;
      }
      const mtimeMs = Math.floor(stat.mtimeMs);
      const existing = this.db
        .prepare("SELECT path, mtime_ms, size, sha256 FROM rag_files WHERE path = ?")
        .get(abs) as FileRow | null;

      if (
        existing &&
        !force &&
        existing.mtime_ms === mtimeMs &&
        existing.size === stat.size
      ) {
        counts.unchanged += 1;
        continue;
      }

      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        counts.skipped += 1;
        continue;
      }
      if (
        isBinary(text) ||
        hasLongLine(text, Math.max(4000, this.config.chunkChars))
      ) {
        counts.skipped += 1;
        continue;
      }

      const sha256 = createHash("sha256").update(text).digest("hex");
      if (existing && !force && existing.sha256 === sha256) {
        this.db
          .prepare(
            "UPDATE rag_files SET mtime_ms = ?, size = ?, indexed_at = ? WHERE path = ?",
          )
          .run(mtimeMs, stat.size, now(), abs);
        counts.unchanged += 1;
        continue;
      }

      const chunks = chunkText(
        text,
        this.config.chunkChars,
        this.config.chunkOverlapChars,
      );
      const idents = chunks.map((chunk) => extractIdentifiers(chunk.text));

      let vectors: Float32Array[] | undefined;
      const provider = this.provider;
      if (provider && embed && !embedError) {
        try {
          vectors = await provider.embed(
            chunks.map((chunk) => `${displayPath(abs)}\n${chunk.text}`),
          );
          this.recordEmbeddings(vectors, force);
        } catch (error) {
          if (error instanceof EmbeddingDimensionError) throw error;
          embedError = errorMessage(error);
          failed += chunks.length;
          vectors = undefined;
        }
      }

      const write = this.db.transaction(() => {
        this.db
          .prepare(
            "DELETE FROM rag_chunks_fts WHERE rowid IN (SELECT id FROM rag_chunks WHERE path = ?)",
          )
          .run(abs);
        this.db.prepare("DELETE FROM rag_chunks WHERE path = ?").run(abs);

        const insertChunk = this.db.prepare(
          `INSERT INTO rag_chunks (path, start_line, end_line, text, ident, embedding, embedding_id, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        );
        const insertFts = this.db.prepare(
          "INSERT INTO rag_chunks_fts(rowid, body, ident) VALUES (?, ?, ?)",
        );
        for (const [index, chunk] of chunks.entries()) {
          const vector = vectors?.[index];
          const row = insertChunk.get(
            abs,
            chunk.startLine,
            chunk.endLine,
            chunk.text,
            idents[index]!,
            vector ? toBlob(vector) : null,
            vector && provider ? provider.id : null,
            now(),
          ) as { id: number };
          insertFts.run(row.id, chunk.text, idents[index]!);
          if (vector) embedded += 1;
        }

        this.db
          .prepare(
            `INSERT INTO rag_files (path, mtime_ms, size, sha256, indexed_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
               mtime_ms = excluded.mtime_ms,
               size = excluded.size,
               sha256 = excluded.sha256,
               indexed_at = excluded.indexed_at`,
          )
          .run(abs, mtimeMs, stat.size, sha256, now());
      });
      write();
      chunksAdded += chunks.length;
      counts.indexed += 1;
    }

    if (isDirectory && !enumeration.truncated) {
      counts.removed = this.prune(root, enumeration.files);
    }

    if (this.provider && embed && !embedError) {
      const backfill = await this.backfill();
      embedded += backfill.embedded;
      failed += backfill.failed;
      if (backfill.error) embedError = backfill.error;
    }

    this.setMeta("last_indexed_at", now());

    const pending = this.provider
      ? (
          this.db
            .prepare("SELECT COUNT(*) AS c FROM rag_chunks WHERE embedding IS NULL")
            .get() as { c: number }
        ).c
      : 0;
    const total = (
      this.db.prepare("SELECT COUNT(*) AS c FROM rag_chunks").get() as {
        c: number;
      }
    ).c;

    const embeddings: JsonObject = {
      provider: this.provider?.id ?? "none",
      embedded,
      pending,
      failed,
    };
    if (failed > 0 && embedError) embeddings.error = embedError;

    return {
      root,
      files: counts,
      chunks: { added: chunksAdded, total },
      embeddings,
      truncated: enumeration.truncated,
      durationMs: Date.now() - started,
    };
  }

  /**
   * A stored corpus built with different vectors cannot be mixed with a new
   * provider: similarity across models is meaningless. Refuse unless the caller
   * explicitly accepts a full re-embed.
   */
  private async ensureEmbeddingCompatibility(force: boolean): Promise<void> {
    if (!this.provider) return;
    const stored = this.getMeta("embedding.id");
    const provider = this.provider;

    let mismatch = false;
    if (stored !== undefined) {
      mismatch = stored !== provider.id;
    } else {
      const embeddedChunks = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS c FROM rag_chunks WHERE embedding IS NOT NULL",
          )
          .get() as { c: number }
      ).c;
      // Vectors without an id come from a run that crashed before recording
      // itself; they cannot be trusted to match the current provider.
      mismatch = embeddedChunks > 0;
    }
    if (!mismatch) return;

    if (!force) {
      const prior = stored ?? "an unknown provider";
      throw new Error(
        `Index was built with embeddings from "${prior}". Re-run rag_index with force:true to re-embed the corpus with "${provider.id}".`,
      );
    }
    this.resetEmbeddings();
  }

  /**
   * Drops every stored vector and the metadata that describes it. One owner,
   * because a partial reset leaves chunks claiming a width they do not have.
   */
  private resetEmbeddings(): void {
    this.db.run("UPDATE rag_chunks SET embedding = NULL, embedding_id = NULL");
    this.db.prepare("DELETE FROM rag_meta WHERE key = ?").run("embedding.id");
    this.db
      .prepare("DELETE FROM rag_meta WHERE key = ?")
      .run("embedding.dimensions");
  }

  private recordEmbeddings(vectors: Float32Array[], force = false): void {
    const dimensions = vectors[0]?.length;
    if (!dimensions) return;
    const stored = this.metaNumber("embedding.dimensions");
    if (stored !== undefined && stored !== dimensions) {
      if (!force) {
        throw new EmbeddingDimensionError(
          `Embedding dimension mismatch: index has ${stored}, provider "${this.provider?.id}" returned ${dimensions}. Re-run rag_index with force:true to re-embed the corpus with "${this.provider?.id}".`,
        );
      }
      // A provider that changed width invalidates every stored vector, not
      // just the ones this call touches.
      this.resetEmbeddings();
    }
    if (!this.provider) return;
    this.setMeta("embedding.id", this.provider.id);
    this.setMeta("embedding.dimensions", String(dimensions));
  }

  private async backfill(): Promise<{
    embedded: number;
    failed: number;
    error?: string;
  }> {
    let embedded = 0;
    let failed = 0;
    const provider = this.provider!;
    const pending = this.db.prepare(
      "SELECT id, path, text FROM rag_chunks WHERE embedding IS NULL LIMIT 5000",
    );
    const update = this.db.prepare(
      "UPDATE rag_chunks SET embedding = ?, embedding_id = ? WHERE id = ?",
    );

    for (;;) {
      const rows = pending.all() as Array<{
        id: number;
        path: string;
        text: string;
      }>;
      if (rows.length === 0) return { embedded, failed };

      let vectors: Float32Array[];
      try {
        vectors = await provider.embed(
          rows.map((row) => `${displayPath(row.path)}\n${row.text}`),
        );
        this.recordEmbeddings(vectors, true);
      } catch (error) {
        if (error instanceof EmbeddingDimensionError) throw error;
        return { embedded, failed: failed + rows.length, error: errorMessage(error) };
      }

      const write = this.db.transaction(() => {
        for (const [index, row] of rows.entries()) {
          const vector = vectors[index];
          if (!vector) continue;
          update.run(toBlob(vector), provider.id, row.id);
          embedded += 1;
        }
      });
      write();
      // Re-query: rows embedded in this pass leave the NULL set, so the loop
      // ends when nothing is left to backfill.
    }
  }

  /** Deletes indexed rows for files that no longer exist under the root. */
  private prune(root: string, enumerated: string[]): number {
    const prefix = `${escapeLike(root + path.sep)}%`;
    const stored = this.db
      .prepare(
        "SELECT path FROM rag_files WHERE path = ? OR path LIKE ? ESCAPE '\\'",
      )
      .all(root, prefix) as Array<{ path: string }>;
    const keep = new Set(enumerated);
    const stale = stored
      .map((row) => row.path)
      .filter((storedPath) => !keep.has(storedPath));
    if (stale.length === 0) return 0;

    const write = this.db.transaction(() => {
      const deleteFts = this.db.prepare(
        "DELETE FROM rag_chunks_fts WHERE rowid IN (SELECT id FROM rag_chunks WHERE path = ?)",
      );
      const deleteChunks = this.db.prepare(
        "DELETE FROM rag_chunks WHERE path = ?",
      );
      const deleteFile = this.db.prepare("DELETE FROM rag_files WHERE path = ?");
      for (const stalePath of stale) {
        deleteFts.run(stalePath);
        deleteChunks.run(stalePath);
        deleteFile.run(stalePath);
      }
    });
    write();
    return stale.length;
  }

  private async enumerate(
    root: string,
    isDirectory: boolean,
    glob: string | undefined,
    cap: number,
  ): Promise<{ files: string[]; truncated: boolean }> {
    if (!isDirectory) return { files: [root], truncated: false };

    const args = ["--files", "--color", "never"];
    if (glob) args.push("--glob", glob);
    args.push("--", root);

    const result = await runCommand("rg", args, {
      timeoutMs: 60_000,
      maxBytes: 8_000_000,
    });
    if (result.timedOut) throw new Error("ripgrep timed out while enumerating files.");
    if (result.code === null) {
      if (result.signal) {
        throw new Error(`ripgrep was killed by ${result.signal}.`);
      }
      throw new Error(
        "ripgrep (rg) is required for rag_index but was not runnable. Install ripgrep and ensure it is on PATH.",
      );
    }
    if (result.code === 1) return { files: [], truncated: false };
    if (result.code !== 0) {
      throw new Error(`ripgrep failed: ${result.stderr.slice(0, 2000)}`);
    }

    const found = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => path.resolve(line));

    // An incomplete enumeration must never drive pruning: a capped list would
    // look like a directory full of deletions.
    const truncated = result.truncated || found.length > cap;
    return { files: found.slice(0, cap), truncated };
  }

  async query(args: QueryArgs): Promise<JsonObject> {
    const query = args.query.trim();
    if (!query) throw new Error("rag query must not be empty");
    if (query.length > 2000) throw new Error("rag query exceeds 2000 characters");

    const topK = clamp(
      1,
      this.config.maxTopK,
      Math.floor(args.topK ?? this.config.defaultTopK),
    );
    const maxChars = clamp(200, 50_000, Math.floor(args.maxChars ?? 8000));

    const filterTarget = args.path
      ? path.resolve(process.cwd(), args.path)
      : undefined;
    const filterParams: string[] = filterTarget
      ? [filterTarget, `${escapeLike(filterTarget + path.sep)}%`]
      : [];
    const pathClause = (column: string): string =>
      `(${column} = ? OR ${column} LIKE ? ESCAPE '\\')`;

    const total = (
      this.db.prepare("SELECT COUNT(*) AS c FROM rag_chunks").get() as {
        c: number;
      }
    ).c;
    if (total === 0) {
      return {
        query,
        count: 0,
        results: [],
        citations: [],
        vectorSearch: {
          enabled: Boolean(this.provider),
          scanned: 0,
          truncated: false,
          pending: 0,
        },
        degraded: { reason: "No indexed chunks; call rag_index first." },
        trimmed: false,
        timingsMs: { lexical: 0, vector: 0 },
      };
    }

    let degraded: string | undefined;

    const lexicalStarted = performance.now();
    const hits = new Map<number, Hit>();
    const lexicalTerms = buildFtsQuery(query);
    const lexicalLimit = Math.max(50, topK * 10);
    if (lexicalTerms) {
      const sql =
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text, ` +
        `bm25(rag_chunks_fts, 1.0, 4.0) AS bm25_score ` +
        `FROM rag_chunks_fts JOIN rag_chunks c ON c.id = rag_chunks_fts.rowid ` +
        `WHERE rag_chunks_fts MATCH ?` +
        (filterTarget ? ` AND ${pathClause("c.path")}` : "") +
        ` ORDER BY bm25_score ASC LIMIT ?`;
      const rows = this.db
        .prepare(sql)
        .all(lexicalTerms, ...filterParams, lexicalLimit) as LexicalRow[];
      rows.forEach((row, index) => {
        hits.set(row.id, {
          id: row.id,
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          text: row.text,
          score: 1 / (60 + (index + 1)),
          lexicalScore: -row.bm25_score,
        });
      });
    }
    const lexicalMs = Math.round(performance.now() - lexicalStarted);

    const vectorStarted = performance.now();
    let vectorScanned = 0;
    let vectorTruncated = false;
    let embeddingPending = 0;
    const provider = this.provider;
    const vectorEnabled = Boolean(provider);
    if (provider) {
      embeddingPending = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS c FROM rag_chunks WHERE embedding IS NULL OR embedding_id IS NOT ?",
          )
          .get(provider.id) as { c: number }
      ).c;
      const storedId = this.getMeta("embedding.id");
      if (storedId !== provider.id) {
        degraded = storedId
          ? `Index embeddings were built with "${storedId}"; run rag_index with force:true to re-embed with "${provider.id}".`
          : `Index has no embeddings for "${provider.id}"; run rag_index with embed enabled to add vector search.`;
      } else {
        try {
          const [queryVector] = await provider.embed([query]);
          if (!queryVector) {
            throw new Error("Embeddings provider returned no vector");
          }
          const storedDims = this.metaNumber("embedding.dimensions");
          if (storedDims !== undefined && storedDims !== queryVector.length) {
            degraded = `Embedding dimension mismatch: index has ${storedDims}, provider "${provider.id}" returned ${queryVector.length}. Re-run rag_index with force:true after switching models.`;
          } else {
            const scanLimit = this.config.maxVectorScan + 1;
            const rows = this.db
              .prepare(
                `SELECT id, path, start_line, end_line, text, embedding FROM rag_chunks ` +
                  `WHERE embedding IS NOT NULL AND embedding_id = ?` +
                  (filterTarget ? ` AND ${pathClause("path")}` : "") +
                  ` ORDER BY id LIMIT ?`,
              )
              .all(provider.id, ...filterParams, scanLimit) as ChunkRow[];
            vectorTruncated = rows.length > this.config.maxVectorScan;
            const scored = rows.slice(0, this.config.maxVectorScan);
            vectorScanned = scored.length;

            const ranked = scored
              .map((row) => {
                // A dimension mismatch is a stale vector, not a match; the
                // length precheck keeps it out of the dot product entirely.
                if (
                  !row.embedding ||
                  vectorLength(row.embedding) !== queryVector.length
                ) {
                  return undefined;
                }
                return {
                  row,
                  similarity: dot(fromBlob(row.embedding), queryVector),
                };
              })
              .filter(
                (entry): entry is { row: ChunkRow; similarity: number } =>
                  entry !== undefined,
              )
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, Math.max(50, topK * 10));

            ranked.forEach(({ row, similarity }, index) => {
              const existingHit = hits.get(row.id);
              const contribution = 1 / (60 + (index + 1));
              if (existingHit) {
                existingHit.score += contribution;
                existingHit.vectorScore = similarity;
              } else {
                hits.set(row.id, {
                  id: row.id,
                  path: row.path,
                  startLine: row.start_line,
                  endLine: row.end_line,
                  text: row.text,
                  score: contribution,
                  vectorScore: similarity,
                });
              }
            });
          }
        } catch (error) {
          degraded = errorMessage(error);
        }
      }
    }
    // Coverage is a fact about the corpus, independent of why the provider
    // failed: a half-embedded index answers worse than it claims to.
    if (embeddingPending > 0 && !degraded) {
      degraded = `${embeddingPending} of ${total} chunk(s) have no embedding for "${provider?.id}"; run rag_index with embed enabled to complete vector search.`;
    }
    const vectorMs = Math.round(performance.now() - vectorStarted);

    const ordered = [...hits.values()].sort(
      (a, b) => b.score - a.score || a.id - b.id,
    );
    const perFile = new Map<string, number>();
    const results: JsonObject[] = [];
    const citations: string[] = [];
    let usedChars = 0;
    let trimmed = false;

    for (const hit of ordered) {
      if (results.length >= topK) break;
      const seen = perFile.get(hit.path) ?? 0;
      // A single chatty file must not crowd every other source out.
      if (seen >= this.config.maxPerFile) continue;
      if (results.length > 0 && usedChars + hit.text.length > maxChars) {
        trimmed = true;
        continue;
      }
      perFile.set(hit.path, seen + 1);
      usedChars += hit.text.length;

      const relative = displayPath(hit.path);
      const citation = `${relative}:${hit.startLine}-${hit.endLine}`;
      const entry: JsonObject = {
        path: relative,
        startLine: hit.startLine,
        endLine: hit.endLine,
        citation,
        score: hit.score,
        text: hit.text,
      };
      if (hit.lexicalScore !== undefined) entry.lexicalScore = hit.lexicalScore;
      if (hit.vectorScore !== undefined) entry.vectorScore = hit.vectorScore;
      results.push(entry);
      citations.push(citation);
    }

    const response: JsonObject = {
      query,
      count: results.length,
      results,
      citations,
      vectorSearch: {
        enabled: vectorEnabled,
        scanned: vectorScanned,
        truncated: vectorTruncated,
        pending: embeddingPending,
      },
      trimmed,
      timingsMs: { lexical: lexicalMs, vector: vectorMs },
    };
    if (degraded) response.degraded = { reason: degraded };
    return response;
  }

  stats(): JsonObject {
    const files = (
      this.db.prepare("SELECT COUNT(*) AS c FROM rag_files").get() as {
        c: number;
      }
    ).c;
    const chunks = (
      this.db.prepare("SELECT COUNT(*) AS c FROM rag_chunks").get() as {
        c: number;
      }
    ).c;
    const textBytes = (
      this.db
        .prepare("SELECT COALESCE(SUM(LENGTH(text)), 0) AS c FROM rag_chunks")
        .get() as { c: number }
    ).c;
    const embeddedChunks = this.provider
      ? (
          this.db
            .prepare(
              "SELECT COUNT(*) AS c FROM rag_chunks WHERE embedding_id = ?",
            )
            .get(this.provider.id) as { c: number }
        ).c
      : (
          this.db
            .prepare(
              "SELECT COUNT(*) AS c FROM rag_chunks WHERE embedding IS NOT NULL",
            )
            .get() as { c: number }
        ).c;

    const embeddings: JsonObject = {
      provider: this.provider?.id ?? "none",
    };
    if (this.provider) {
      embeddings.model = this.provider.model;
      const dimensions = this.metaNumber("embedding.dimensions");
      if (dimensions !== undefined) embeddings.dimensions = dimensions;
    }

    const stats: JsonObject = {
      dbPath: this.config.dbPath,
      files,
      chunks,
      textBytes,
      embeddedChunks,
      embeddings,
      maxFiles: this.config.maxFiles,
    };
    const lastIndexedAt = this.getMeta("last_indexed_at");
    if (lastIndexedAt) stats.lastIndexedAt = lastIndexedAt;
    return stats;
  }

  forget(input: string): JsonObject {
    const abs = path.resolve(process.cwd(), input);
    if (abs === path.parse(abs).root) {
      throw new Error("Refusing to forget the filesystem root.");
    }
    const prefix = `${escapeLike(abs + path.sep)}%`;
    const files = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS c FROM rag_files WHERE path = ? OR path LIKE ? ESCAPE '\\'",
        )
        .get(abs, prefix) as { c: number }
    ).c;
    const chunks = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS c FROM rag_chunks WHERE path = ? OR path LIKE ? ESCAPE '\\'",
        )
        .get(abs, prefix) as { c: number }
    ).c;

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM rag_chunks_fts WHERE rowid IN (SELECT id FROM rag_chunks WHERE path = ? OR path LIKE ? ESCAPE '\\')",
        )
        .run(abs, prefix);
      this.db
        .prepare(
          "DELETE FROM rag_chunks WHERE path = ? OR path LIKE ? ESCAPE '\\'",
        )
        .run(abs, prefix);
      this.db
        .prepare(
          "DELETE FROM rag_files WHERE path = ? OR path LIKE ? ESCAPE '\\'",
        )
        .run(abs, prefix);
    });
    write();

    return {
      path: displayPath(abs),
      removed: files + chunks > 0,
      files,
      chunks,
    };
  }

  close(): void {
    this.db.close();
  }

  private getMeta(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM rag_meta WHERE key = ?")
      .get(key) as { value: string } | null;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO rag_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private metaNumber(key: string): number | undefined {
    const value = this.getMeta(key);
    if (value === undefined) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
}
