type Level = "error" | "warn" | "info" | "debug";

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function configuredLevel(): Level {
  const raw = (process.env.ARIVE_LOG ?? "info").toLowerCase();
  return raw === "error" || raw === "warn" || raw === "debug" ? raw : "info";
}

const threshold = ORDER[configuredLevel()];

/**
 * All diagnostics go to stderr. stdout is the MCP transport and must stay clean.
 */
export function log(level: Level, message: string, meta?: unknown): void {
  if (ORDER[level] > threshold) return;
  const suffix = meta === undefined ? "" : ` ${safeJson(meta)}`;
  process.stderr.write(`[arive] ${level}: ${message}${suffix}\n`);
}

export function safeJson(value: unknown, max = 1200): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
