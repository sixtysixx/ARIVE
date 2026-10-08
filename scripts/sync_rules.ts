#!/usr/bin/env bun
/**
 * Single source of truth for the shipped Fade rules.
 *
 * `rules/fade.md` is authoritative; every editor-specific copy below is
 * rendered from it so they can never drift or accumulate duplicate copies.
 *
 *   bun run rules:sync    # render every copy
 *   bun run rules:check   # exit 1 when a copy is out of date (used by CI)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const SOURCE = "rules/fade.md";

interface RuleTarget {
  /** Repo-relative destination path. */
  path: string;
  /** Verbatim text prepended to the source (editor frontmatter). */
  header?: string;
}

/** Every tracked per-editor copy of the Fade rules. */
const TARGETS: RuleTarget[] = [
  { path: ".agents/rules/fade.md" },
  { path: ".antigravity/rules/fade.md" },
  { path: ".kiro/steering/fade.md" },
  { path: ".omp/rules/fade.md" },
  { path: ".windsurf/rules/fade.md" },
  { path: ".clauderules" },
  { path: ".clinerules" },
  { path: ".kilocoderules" },
  {
    path: ".cursor/rules/fade.mdc",
    header:
      "---\n" +
      "description: Fade, lazy senior dev mode\n" +
      'globs: "*"\n' +
      "alwaysApply: true\n" +
      "---\n",
  },
  {
    path: ".opencode/command/fade.md",
    header: "---\ndescription: Fade fade command\n---\n",
  },
];

const sourcePath = path.join(ROOT, SOURCE);
if (!fs.existsSync(sourcePath)) {
  console.error(`[sync-rules] source not found: ${SOURCE}`);
  process.exit(1);
}

const source = fs.readFileSync(sourcePath, "utf-8");
// Match the source's line endings so generated headers don't mix CRLF and LF.
const eol = source.includes("\r\n") ? "\r\n" : "\n";

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const target of TARGETS) {
  const rendered = (target.header?.split("\n").join(eol) ?? "") + source;
  const dest = path.join(ROOT, target.path);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf-8") : null;

  if (current === rendered) {
    continue;
  }

  if (check) {
    stale.push(target.path);
    continue;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, rendered, "utf-8");
  console.log(`[sync-rules] wrote ${target.path}`);
}

if (!check) {
  console.log(`[sync-rules] ${TARGETS.length} rule files rendered from ${SOURCE}`);
} else if (stale.length > 0) {
  console.error(
    `[sync-rules] ${stale.length} rule file(s) out of date with ${SOURCE}:`,
  );
  for (const file of stale) {
    console.error(`  - ${file}`);
  }
  console.error("Run: bun run rules:sync");
  process.exit(1);
} else {
  console.log(`[sync-rules] all ${TARGETS.length} rule files match ${SOURCE}`);
}
