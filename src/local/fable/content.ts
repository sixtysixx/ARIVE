import * as fs from "fs";
import { fileURLToPath } from "url";

/**
 * The fable-method ruleset, vendored as markdown so the gateway works offline.
 * Updating it is a deliberate re-copy from upstream, not a runtime fetch.
 */
export const FABLE_UPSTREAM = {
  repo: "Sahir619/fable-method",
  commit: "9924067e82bd48cf3b0426378db93238bfb33e9b",
  version: "1.4.0",
  license: "MIT",
} as const;

export const FABLE_DOCS = {
  method: "fable-method/SKILL.md",
  loop: "fable-loop/SKILL.md",
  judge: "fable-judge/SKILL.md",
  domain: "fable-domain/SKILL.md",
  "failure-modes": "fable-method/references/failure-modes.md",
  flowcharts: "fable-method/references/flowcharts.md",
  examples: "fable-method/references/examples.md",
} as const;

export type FableDocKey = keyof typeof FABLE_DOCS;

export const FABLE_DOMAINS = [
  "marketing",
  "research",
  "data-analysis",
  "business-ops",
  "finance",
  "legal-compliance",
  "design-ux",
  "devops",
] as const;

const cache = new Map<string, string>();

/** Drops a leading YAML frontmatter block; the rules start after it. */
function stripFrontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines[0] !== "---") return text;
  const close = lines.indexOf("---", 1);
  if (close === -1) return text;
  return lines
    .slice(close + 1)
    .join("\n")
    .replace(/^\n+/, "");
}

function read(relativePath: string): string {
  const cached = cache.get(relativePath);
  if (cached !== undefined) return cached;
  const file = fileURLToPath(new URL(`./content/${relativePath}`, import.meta.url));
  let text: string;
  try {
    // A Windows checkout hands back CRLF; the rules are the same either way,
    // and a trailing \r would keep the frontmatter fence from matching.
    text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    throw new Error(
      `fable content missing: ${relativePath} (a full checkout of src/local/fable/content is required)`,
    );
  }
  const stripped = stripFrontmatter(text);
  cache.set(relativePath, stripped);
  return stripped;
}

export function loadDoc(key: FableDocKey): string {
  return read(FABLE_DOCS[key]);
}

export function loadDomain(name: string): string {
  if (!(FABLE_DOMAINS as readonly string[]).includes(name)) {
    throw new Error(
      `Unknown domain "${name}". Known adapters: ${FABLE_DOMAINS.join(", ")}. Coding is the default and needs no adapter.`,
    );
  }
  return read(`fable-method/references/domains/${name}.md`);
}
