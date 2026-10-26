import * as path from "path";
import { runCommand } from "../core/exec.js";
import {
  errorResult,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  textResult,
  type LocalTool,
} from "../core/results.js";

interface Match {
  file: string;
  line: number;
  column: number;
  text: string;
}

interface RgMatch {
  type: "match";
  data: {
    path: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    submatches?: Array<{ start?: number }>;
  };
}

function relative(file: string): string {
  const resolved = path.resolve(file);
  const rel = path.relative(process.cwd(), resolved);
  return rel === "" ? resolved : rel;
}

function truncate(value: string, max = 500): string {
  const line = value.replace(/\r?\n$/, "");
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function createSearchTools(defaultMaxResults: number): LocalTool[] {
  return [
    {
      name: "search_query",
      description:
        "[SEARCH] Ripgrep content search. Returns file, line, column, and the matching line. Respects .gitignore by default.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Ripgrep pattern." },
          path: {
            type: "string",
            description: "File or directory to search. Defaults to cwd.",
          },
          glob: {
            type: "string",
            description: "Optional glob filter, e.g. '*.ts'.",
          },
          caseSensitive: { type: "boolean", default: false },
          fixedStrings: {
            type: "boolean",
            description: "Treat the pattern as a literal string.",
            default: false,
          },
          maxResults: { type: "integer", default: defaultMaxResults },
        },
        required: ["pattern"],
      },
      handler: async (args) => {
        const pattern = requireString(args, "pattern", "search_query");
        const target = optionalString(args, "path") ?? process.cwd();
        const glob = optionalString(args, "glob");
        const maxResults = Math.min(
          200,
          Math.max(1, optionalNumber(args, "maxResults") ?? defaultMaxResults),
        );

        const rgArgs = ["--json", "--no-heading", "--color", "never"];
        if (!(optionalBoolean(args, "caseSensitive") ?? false))
          rgArgs.push("--ignore-case");
        if (optionalBoolean(args, "fixedStrings") ?? false)
          rgArgs.push("--fixed-strings");
        if (glob) rgArgs.push("--glob", glob);
        rgArgs.push("--", pattern, target);

        const result = await runCommand("rg", rgArgs, { timeoutMs: 20_000 });
        if (result.code === null) {
          return errorResult(
            "ripgrep (rg) is required for search_query but was not runnable. Install ripgrep and ensure it is on PATH.",
            { detail: result.stderr.trim() },
          );
        }
        if (result.code === 1) {
          return textResult({ matches: [], count: 0, pattern });
        }
        if (result.code !== 0) {
          return errorResult("ripgrep failed.", {
            exitCode: result.code,
            stderr: truncate(result.stderr, 2000),
          });
        }

        const matches: Match[] = [];
        for (const line of result.stdout.split("\n")) {
          if (!line.trim()) continue;
          let parsed: RgMatch;
          try {
            parsed = JSON.parse(line) as RgMatch;
          } catch {
            continue;
          }
          if (parsed.type !== "match") continue;
          const file = parsed.data.path.text ?? "";
          matches.push({
            file: relative(file),
            line: parsed.data.line_number ?? 0,
            column: (parsed.data.submatches?.[0]?.start ?? 0) + 1,
            text: truncate(parsed.data.lines?.text ?? ""),
          });
          if (matches.length >= maxResults) break;
        }

        return textResult({
          pattern,
          count: matches.length,
          truncated: matches.length >= maxResults,
          matches,
        });
      },
    },
    {
      name: "search_files",
      description:
        "[SEARCH] List files via ripgrep. Fast project-wide file discovery with optional glob filtering.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory to scan. Defaults to cwd.",
          },
          glob: {
            type: "string",
            description: "Optional glob filter, e.g. '*.ts'.",
          },
          maxResults: { type: "integer", default: defaultMaxResults },
        },
      },
      handler: async (args) => {
        const target = optionalString(args, "path") ?? process.cwd();
        const glob = optionalString(args, "glob");
        const maxResults = Math.min(
          1000,
          Math.max(1, optionalNumber(args, "maxResults") ?? defaultMaxResults),
        );

        const rgArgs = ["--files", "--color", "never"];
        if (glob) rgArgs.push("--glob", glob);
        rgArgs.push(target);

        const result = await runCommand("rg", rgArgs, { timeoutMs: 20_000 });
        if (result.code === null) {
          return errorResult(
            "ripgrep (rg) is required for search_files but was not runnable. Install ripgrep and ensure it is on PATH.",
            { detail: result.stderr.trim() },
          );
        }
        if (result.code !== 0) {
          return errorResult("ripgrep failed.", {
            exitCode: result.code,
            stderr: truncate(result.stderr, 2000),
          });
        }

        const files = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, maxResults)
          .map(relative);

        return textResult({ count: files.length, files });
      },
    },
  ];
}
