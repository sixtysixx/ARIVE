/**
 * Line-ranged chunking for the retrieval index.
 *
 * Chunks carry 1-based inclusive line ranges so every retrieval hit can be
 * cited as `path:start-end` and re-read with the same numbers an editor shows.
 */

export interface Chunk {
  text: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

/**
 * A line that starts a plausible unit of meaning. Chunk cuts prefer these so a
 * retrieved window usually begins at a declaration or a heading instead of the
 * middle of a statement.
 */
const BOUNDARY =
  /^\s{0,3}(#{1,6}\s|```|(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|namespace|const|let|var|def|fn|struct|impl|trait|pub\s+fn|public|private|protected|static)\b)/;

function splitLines(content: string): string[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  // A file that ends with a newline has no line after it: counting the empty
  // tail would inflate every citation by one line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function chunkText(
  content: string,
  maxChars: number,
  overlapChars: number,
): Chunk[] {
  const lines = splitLines(content);
  const chunks: Chunk[] = [];
  let start = 0;

  while (start < lines.length) {
    while (start < lines.length && lines[start]!.trim() === "") start += 1;
    if (start >= lines.length) break;

    let end = start;
    let chars = 0;
    while (end < lines.length && chars + lines[end]!.length + 1 <= maxChars) {
      chars += lines[end]!.length + 1;
      end += 1;
    }
    // A single line can exceed maxChars; it is emitted whole rather than split,
    // because a half-line has no useful citation and the indexer skips files
    // whose lines are absurdly long anyway.
    if (end === start) end = start + 1;

    if (end >= lines.length) {
      const text = lines.slice(start).join("\n");
      if (text.trim() !== "") {
        chunks.push({
          text,
          startLine: start + 1,
          endLine: lines.length,
        });
      }
      break;
    }

    const floor = start + Math.max(1, Math.floor((end - start) / 2));
    let cut = end - 1;
    for (let i = end - 1; i >= floor; i -= 1) {
      const line = lines[i]!;
      if (line.trim() === "" || BOUNDARY.test(line)) {
        cut = i;
        break;
      }
    }

    const text = lines.slice(start, cut + 1).join("\n");
    if (text.trim() !== "") {
      chunks.push({
        text,
        startLine: start + 1,
        endLine: cut + 1,
      });
    }

    // Pull the next window back over the trailing lines so a definition split
    // across a boundary is still retrievable from either side.
    let next = cut + 1;
    let overlap = 0;
    while (
      next - 1 > start &&
      overlap + lines[next - 1]!.length + 1 <= overlapChars
    ) {
      next -= 1;
      overlap += lines[next]!.length + 1;
    }
    // Guarantee progress even when overlapChars covers the whole window.
    start = Math.max(next, start + 1);
  }

  return chunks;
}

/**
 * Flattens identifiers into searchable words: the original token, its
 * `_`/`$`-separated parts, and its camelCase parts, so `CompressPayload` also
 * matches `compress` and `payload`.
 */
export function extractIdentifiers(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string): void => {
    const token = value.trim().toLowerCase();
    if (token.length < 2 || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  for (const match of text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []) {
    add(match);
    for (const part of match.split(/[_$]+/)) add(part);
    for (const part of match
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[\s_$]+/)) {
      add(part);
    }
  }

  return out.join(" ").slice(0, 4000);
}

export function hasLongLine(content: string, maxLineChars = 4000): boolean {
  return splitLines(content).some((line) => line.length > maxLineChars);
}
