import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CompressionConfig } from "./config.js";
import { isTextBlock } from "./results.js";
import { errorMessage, log } from "./log.js";

interface Entry {
  text: string;
  createdAt: number;
}

export interface CompressedText {
  text: string;
  compressed: boolean;
  ref?: string;
}

export interface CompressionStats {
  enabled: boolean;
  entries: number;
  bytes: number;
  compressions: number;
  maxEntries: number;
  thresholdTokens: number;
  storeDir?: string;
}

const CHARS_PER_TOKEN = 4;
const MAX_STORE_BYTES = 64 * 1024 * 1024;
/** Disk retention is a persistence cache, so it is bounded separately. */
const MAX_DISK_BYTES = 256 * 1024 * 1024;
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DISK_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Headroom-style reversible compression. Oversized payloads are replaced by a
 * short envelope carrying a `ctx:` reference; the original is retained (LRU in
 * memory, optionally on disk) and can be recovered verbatim.
 */
export class ContextCompressor {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private compressions = 0;
  private lastDiskPrune = 0;
  private pendingWrites: Promise<void> = Promise.resolve();
  private readonly writeFailures = new Map<string, string>();
  private readonly config: CompressionConfig;

  constructor(config: CompressionConfig) {
    this.config = config;
    if (config.storeDir) {
      try {
        fs.mkdirSync(path.resolve(config.storeDir), { recursive: true });
      } catch (error) {
        log(
          "warn",
          `cannot create compression store dir: ${errorMessage(error)}`,
        );
      }
      this.pruneDiskSync(Date.now());
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get thresholdChars(): number {
    return Math.max(
      1,
      Math.floor(this.config.thresholdTokens * CHARS_PER_TOKEN),
    );
  }

  store(text: string): string {
    const digest = createHash("sha256").update(text).digest("hex").slice(0, 32);
    const ref = `ctx:${digest}`;

    const existing = this.entries.get(ref);
    if (existing) {
      this.entries.delete(ref);
      this.entries.set(ref, existing);
      // TTL pruning deletes the file, not the memory entry; reusing the ref
      // must restore the disk copy or `durable` becomes a lie again.
      if (this.config.storeDir) {
        const file = path.resolve(this.config.storeDir, `${digest}.txt`);
        if (!fs.existsSync(file)) this.persist(ref, existing.text);
      }
      return ref;
    }

    this.entries.set(ref, { text, createdAt: Date.now() });
    this.bytes += text.length;
    this.evict(ref);
    this.persist(ref, text);
    return ref;
  }

  retrieve(ref: string): string | null {
    const normalized = ref.startsWith("ctx:") ? ref : `ctx:${ref}`;
    // A ref is an id this store minted, never a path fragment. Without this a
    // caller could steer the disk read at an arbitrary path.
    if (!/^ctx:[0-9a-f]{32}$/.test(normalized)) return null;
    const entry = this.entries.get(normalized);
    if (entry) {
      this.entries.delete(normalized);
      this.entries.set(normalized, entry);
      return entry.text;
    }

    if (this.config.storeDir) {
      const file = path.resolve(
        this.config.storeDir,
        `${normalized.slice("ctx:".length)}.txt`,
      );
      try {
        if (fs.existsSync(file)) {
          const text = fs.readFileSync(file, "utf8");
          // The TTL pruner measures use, so a read must reset the clock.
          // Best effort: a failed touch only affects retention.
          void fs.promises.utimes(file, new Date(), new Date()).catch(() => {});
          // Rehydrate into the LRU so repeat reads are cheap.
          this.entries.set(normalized, { text, createdAt: Date.now() });
          this.bytes += text.length;
          this.evict(normalized);
          return text;
        }
      } catch (error) {
        log(
          "warn",
          `failed reading compressed payload: ${errorMessage(error)}`,
        );
      }
    }
    return null;
  }

  compressText(
    text: string,
    namespace: string,
    force = false,
    omitted?: string[],
  ): CompressedText {
    if (
      !force &&
      (!this.config.enabled || text.length <= this.thresholdChars)
    ) {
      return { text, compressed: false };
    }

    const ref = this.store(text);
    this.compressions += 1;

    const preview =
      text.length > this.config.previewChars
        ? `${text.slice(0, this.config.previewChars)}…`
        : text;

    // Durability is a property of the write, not of the config: say which one
    // this ref actually lives in so the reader knows whether it can wait.
    const requested = this.config.storeDir !== undefined;
    const failure = this.writeFailures.get(ref);
    const durable = requested && failure === undefined;
    const memoryHint = `Original retained in memory only (LRU, ${this.config.maxEntries} entries) and may be evicted; call context_retrieve with {"ref":"${ref}"} soon.`;
    const hint =
      failure !== undefined
        ? `Disk retention failed for this payload (${failure}); ${memoryHint}`
        : durable
          ? `Original retained losslessly on disk. Call context_retrieve with {"ref":"${ref}"} to recover it.`
          : memoryHint;
    const envelope = {
      _arive_compressed: true,
      ref,
      namespace,
      originalChars: text.length,
      estimatedOriginalTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      preview,
      durable,
      ...(omitted?.length ? { omitted } : {}),
      hint: omitted?.length
        ? `${hint} Structured content was not retained.`
        : hint,
    };
    return { text: JSON.stringify(envelope, null, 2), compressed: true, ref };
  }

  /**
   * Replaces oversized text blocks in a tool result. Non-text blocks (images,
   * audio, resources) are always preserved untouched.
   */
  apply(result: CallToolResult, namespace: string): CallToolResult {
    // An error envelope would hide the failure text behind a ref, so failures
    // always pass through verbatim.
    if (!this.config.enabled || result.isError) return result;

    let compressedAny = false;
    const content = result.content.map((block) => {
      if (!isTextBlock(block)) return block;
      const replaced = this.compressText(
        block.text,
        namespace,
        false,
        result.structuredContent ? ["structuredContent"] : undefined,
      );
      if (!replaced.compressed) return block;
      compressedAny = true;
      return { type: "text" as const, text: replaced.text };
    });

    if (!compressedAny) return result;
    const next = {
      ...result,
      content,
      // Structured content duplicates the text; the ref is authoritative now.
      structuredContent: undefined,
    } as CallToolResult & { structuredContentOmitted?: boolean };
    // Distinguish "the gateway removed it" from "the server never sent any".
    if (result.structuredContent) next.structuredContentOmitted = true;
    return next;
  }

  stats(): CompressionStats {
    return {
      enabled: this.config.enabled,
      entries: this.entries.size,
      bytes: this.bytes,
      compressions: this.compressions,
      maxEntries: this.config.maxEntries,
      thresholdTokens: this.config.thresholdTokens,
      ...(this.config.storeDir ? { storeDir: this.config.storeDir } : {}),
    };
  }

  private persist(ref: string, text: string): void {
    const storeDir = this.config.storeDir;
    if (!storeDir) return;
    const file = path.resolve(storeDir, `${ref.slice("ctx:".length)}.txt`);
    // The write is a cache spill, not part of the answer: the request path
    // returns immediately, and writes stay in submission order. The trailing
    // catch keeps one failure from poisoning the queue for every later ref.
    this.pendingWrites = this.pendingWrites
      .then(() => fs.promises.writeFile(file, text, "utf8"))
      .then(() => {
        this.writeFailures.delete(ref);
        return this.pruneDisk();
      })
      .catch((error: unknown) => {
        this.writeFailures.set(ref, errorMessage(error));
        log(
          "warn",
          `failed persisting compressed payload: ${errorMessage(error)}`,
        );
      });
  }

  /** Resolves once every queued spill has been written and pruned. */
  async flush(): Promise<void> {
    await this.pendingWrites;
  }

  /**
   * Bounds the on-disk retention cache. Deleting a file is safe for a ref the
   * process still holds in memory: `retrieve` checks the LRU first.
   */
  private async pruneDisk(): Promise<void> {
    const storeDir = this.config.storeDir;
    if (!storeDir) return;
    const now = Date.now();
    if (now - this.lastDiskPrune < DISK_PRUNE_INTERVAL_MS) return;
    this.lastDiskPrune = now;

    const dir = path.resolve(storeDir);
    let files: Array<{ file: string; size: number; mtimeMs: number }>;
    try {
      const names = await fs.promises.readdir(dir);
      files = await Promise.all(
        names
          .filter((name) => name.endsWith(".txt"))
          .map(async (name) => {
            const file = path.join(dir, name);
            const stat = await fs.promises.stat(file);
            return { file, size: stat.size, mtimeMs: stat.mtimeMs };
          }),
      );
    } catch (error) {
      log("warn", `cannot scan compression store: ${errorMessage(error)}`);
      return;
    }

    for (const file of selectPrunable(files, now)) {
      try {
        await fs.promises.rm(file, { force: true });
      } catch (error) {
        log(
          "warn",
          `failed pruning compressed payload: ${errorMessage(error)}`,
        );
      }
    }
  }

  /**
   * The constructor's scan: it must run before the first request, so it stays
   * synchronous and unconditional. It shares the selection rule with the
   * periodic prune above, so the two cannot drift.
   */
  private pruneDiskSync(now: number): void {
    const storeDir = this.config.storeDir;
    if (!storeDir) return;
    this.lastDiskPrune = now;

    const dir = path.resolve(storeDir);
    let files: Array<{ file: string; size: number; mtimeMs: number }>;
    try {
      files = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".txt"))
        .map((name) => {
          const file = path.join(dir, name);
          const stat = fs.statSync(file);
          return { file, size: stat.size, mtimeMs: stat.mtimeMs };
        });
    } catch (error) {
      log("warn", `cannot scan compression store: ${errorMessage(error)}`);
      return;
    }

    for (const file of selectPrunable(files, now)) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        log(
          "warn",
          `failed pruning compressed payload: ${errorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Bounds the LRU. `keep` is the ref just minted or just rehydrated: evicting
   * it would hand back a reference that cannot be resolved, so the byte cap may
   * be exceeded by that one entry instead. `keep` is always the newest entry
   * today, so this states the invariant rather than patching a live branch.
   */
  private evict(keep?: string): void {
    while (
      this.entries.size > this.config.maxEntries ||
      (this.bytes > MAX_STORE_BYTES && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === keep) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= entry?.text.length ?? 0;
    }
  }
}

/**
 * Chooses which spill files to delete: everything past the TTL, then the oldest
 * while the survivors still exceed the byte budget. Both prune drivers call
 * this so the startup scan and the periodic scan cannot disagree.
 */
function selectPrunable(
  files: Array<{ file: string; size: number; mtimeMs: number }>,
  now: number,
): string[] {
  const doomed = files
    .filter((entry) => now - entry.mtimeMs > DISK_TTL_MS)
    .map((entry) => entry.file);

  const survivors = files
    .filter((entry) => now - entry.mtimeMs <= DISK_TTL_MS)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let total = survivors.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of survivors) {
    if (total <= MAX_DISK_BYTES) break;
    doomed.push(entry.file);
    total -= entry.size;
  }
  return doomed;
}
