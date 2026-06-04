import { expect, test, describe } from "bun:test";
import { CodeMapScanner } from "../src/analyze/codemap.js";

describe("CodeMap Scanner Tests", () => {
  test("Build folder structure tree", () => {
    const scanner = new CodeMapScanner();
    const tree = scanner.scanTree("./src");
    expect(tree).toContain("analyze");
    expect(tree).toContain("reason");
  });

  test("Parse TypeScript exports & imports", () => {
    const dummyCode = `
      import { Helper } from "./helper.js";
      import ts from "typescript";

      export interface Info {
        name: string;
      }

      export class Analyzer {
        public analyze() { return true; }
      }

      export function runUtility() {}
    `;
    const scanner = new CodeMapScanner();
    const parsed = scanner.parseFileMetadata(dummyCode);
    
    expect(parsed.imports).toContain("./helper.js");
    expect(parsed.imports).toContain("typescript");
    expect(parsed.exports.classes[0].name).toBe("Analyzer");
    expect(parsed.exports.classes[0].methods).toContain("analyze");
    expect(parsed.exports.functions).toContain("runUtility");
    expect(parsed.exports.interfaces).toContain("Info");
  });

  test("Respects maxDepth recursion limit", () => {
    const scanner = new CodeMapScanner();
    const tree = scanner.scanTree("./src", [], 1);
    expect(tree).toContain("⚠️ [Max depth of 1 reached]");
  });

  test("getGitDiff rejects command injection and invalid branch names", () => {
    const scanner = new CodeMapScanner();
    const result = scanner.getGitDiff("master; rm -rf /");
    expect(result).toBe("Git diff failed: Invalid branch name pattern.");
  });

  test("scanDependencies recursively parses JS/TS files", () => {
    const scanner = new CodeMapScanner();
    const results = scanner.scanDependencies("./src/analyze");
    expect(Object.keys(results).length).toBeGreaterThan(0);
    // Find one file we know has imports, like codemap.ts or ast_compressor.ts
    const keys = Object.keys(results);
    const codemapKey = keys.find(k => k.endsWith("codemap.ts"));
    if (codemapKey) {
      expect(results[codemapKey].imports.length).toBeGreaterThan(0);
      expect(results[codemapKey].exports.classes.length).toBeGreaterThan(0);
    }
  });
});


