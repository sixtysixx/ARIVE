import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CompressionConfig } from "./config.js";
import { isTextBlock } from "./results.js";
import { errorMessage, log } from "./log.js";

interface Entry {
  text: string;
  namespace: string;
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

/**
 * Headroom-style reversible compression. Oversized payloads are replaced by a
 * short envelope carrying a `ctx:` reference; the original is retained (LRU in
 * memory, optionally on disk) and can be recovered verbatim.
 */
export class ContextCompressor {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private compressions = 0;
  private readonly config: CompressionConfig;

  constructor(config: CompressionConfig) {
    this.config = config;
    if (config.storeDir) {
      try {
        fs.mkdirSync(path.resolve(config.storeDir), { recursive: true });
      } catch (error) {
        log("warn", `cannot create compression store dir: ${errorMessage(error)}`);
      }
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get thresholdChars(): number {
    return Math.max(1, Math.floor(this.config.thresholdTokens * CHARS_PER_TOKEN));
  }

  store(text: string, namespace: string): string {
    const digest = createHash("sha256").update(text).digest("hex").slice(0, 32);
    const ref = `ctx:${digest}`;

    const existing = this.entries.get(ref);
    if (existing) {
      this.entries.delete(ref);
      this.entries.set(ref, existing);
      return ref;
    }

    this.entries.set(ref, { text, namespace, createdAt: Date.now() });
    this.bytes += text.length;
    this.evict();
    this.persist(ref, text);
    return ref;
  }

  retrieve(ref: string): string | null {
    const normalized = ref.startsWith("ctx:") ? ref : `ctx:${ref}`;
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
          // Rehydrate into the LRU so repeat reads are cheap.
          this.entries.set(normalized, {
            text,
            namespace: "disk",
            createdAt: Date.now(),
          });
          this.bytes += text.length;
          this.evict();
          return text;
        }
      } catch (error) {
        log("warn", `failed reading compressed payload: ${errorMessage(error)}`);
      }
    }
    return null;
  }

  compressText(text: string, namespace: string, force = false): CompressedText {
    if (!force && (!this.config.enabled || text.length <= this.thresholdChars)) {
      return { text, compressed: false };
    }

    const ref = this.store(text, namespace);
    this.compressions += 1;

    const preview =
      text.length > this.config.previewChars
        ? `${text.slice(0, this.config.previewChars)}…`
        : text;

    const envelope = {
      _arive_compressed: true,
      ref,
      namespace,
      originalChars: text.length,
      estimatedOriginalTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      preview,
      hint: `Original retained losslessly. Call context_retrieve with {"ref":"${ref}"} to recover it.`,
    };
    return { text: JSON.stringify(envelope, null, 2), compressed: true, ref };
  }

  /**
   * Replaces oversized text blocks in a tool result. Non-text blocks (images,
   * audio, resources) are always preserved untouched.
   */
  apply(result: CallToolResult, namespace: string): CallToolResult {
    if (!this.config.enabled) return result;

    let compressedAny = false;
    const content = result.content.map((block) => {
      if (!isTextBlock(block)) return block;
      const replaced = this.compressText(block.text, namespace);
      if (!replaced.compressed) return block;
      compressedAny = true;
      return { type: "text" as const, text: replaced.text };
    });

    if (!compressedAny) return result;
    return {
      ...result,
      content,
      // Structured content duplicates the text; the ref is authoritative now.
      structuredContent: undefined,
    };
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
    if (!this.config.storeDir) return;
    try {
      const file = path.resolve(
        this.config.storeDir,
        `${ref.slice("ctx:".length)}.txt`,
      );
      fs.writeFileSync(file, text, "utf8");
    } catch (error) {
      log("warn", `failed persisting compressed payload: ${errorMessage(error)}`);
    }
  }

  private evict(): void {
    while (
      this.entries.size > this.config.maxEntries ||
      (this.bytes > MAX_STORE_BYTES && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= entry?.text.length ?? 0;
    }
  }
}
