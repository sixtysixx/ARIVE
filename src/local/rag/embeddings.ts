import type { RagEmbeddingConfig } from "../../core/config.js";

export interface EmbeddingProvider {
  /** Stable identity written into the index: `${provider}:${model}`. */
  readonly id: string;
  readonly provider: "ollama" | "openai";
  readonly model: string;
  /** Returns L2-normalized vectors, one per input, in input order. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Normalizes one vector in place and returns it as a Float32Array. */
function normalizeVector(vector: number[], providerId: string): Float32Array {
  if (vector.length === 0) {
    throw new Error(`Embeddings provider "${providerId}" returned an empty vector`);
  }
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error(
      `Embeddings provider "${providerId}" returned a zero-norm vector`,
    );
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm;
  return out;
}

function toVectors(
  raw: unknown,
  expected: number,
  providerId: string,
): Float32Array[] {
  if (!Array.isArray(raw) || raw.length !== expected) {
    const got = Array.isArray(raw) ? raw.length : "no";
    throw new Error(
      `Embeddings provider "${providerId}" returned ${got} vector(s) for ${expected} input(s)`,
    );
  }
  const vectors = raw.map((entry, index) => {
    if (!Array.isArray(entry)) {
      throw new Error(
        `Embeddings provider "${providerId}" returned a malformed vector at index ${index}`,
      );
    }
    return normalizeVector(entry as number[], providerId);
  });
  const dimensions = vectors[0]!.length;
  for (const vector of vectors) {
    if (vector.length !== dimensions) {
      throw new Error(
        `Embeddings provider "${providerId}" returned mixed vector dimensions`,
      );
    }
  }
  return vectors;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  config: RagEmbeddingConfig,
  providerId: string,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Embeddings request failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(
      `Embeddings provider "${providerId}" returned a non-JSON response`,
    );
  }
}

export function createEmbeddingProvider(
  config: RagEmbeddingConfig,
): EmbeddingProvider | undefined {
  if (config.provider === "none") return undefined;

  const provider = config.provider;
  const model =
    config.model ??
    (provider === "ollama" ? "nomic-embed-text" : "text-embedding-3-small");
  const id = `${provider}:${model}`;
  const baseUrl = trimUrl(
    config.baseUrl ??
      (provider === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_OPENAI_URL),
  );
  const batchSize = Math.max(1, config.batchSize);

  return {
    id,
    provider,
    model,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const out: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += batchSize) {
        const batch = texts.slice(offset, offset + batchSize);
        if (provider === "ollama") {
          const payload = (await postJson(
            `${baseUrl}/api/embed`,
            { model, input: batch, truncate: true },
            {},
            config,
            id,
          )) as { embeddings?: unknown };
          out.push(...toVectors(payload.embeddings, batch.length, id));
          continue;
        }

        // Read on each call: a missing key is a runtime failure the caller can
        // degrade from, not a reason to refuse to start the gateway.
        const apiKey = process.env[config.apiKeyEnv]?.trim() ?? "";
        if (!apiKey) {
          throw new Error(
            `Embeddings provider "openai" requires ${config.apiKeyEnv}`,
          );
        }
        const payload = (await postJson(
          `${baseUrl}/embeddings`,
          { model, input: batch },
          { authorization: `Bearer ${apiKey}` },
          config,
          id,
        )) as { data?: unknown };
        const data = Array.isArray(payload.data)
          ? (payload.data as Array<{ index?: number; embedding?: unknown }>)
          : [];
        const ordered = [...data].sort(
          (a, b) => (a.index ?? 0) - (b.index ?? 0),
        );
        out.push(
          ...toVectors(
            ordered.map((entry) => entry.embedding),
            batch.length,
            id,
          ),
        );
      }
      return out;
    },
  };
}
