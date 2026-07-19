import * as fs from "fs";
import * as path from "path";
import * as os from "os";
 import { expect, test, describe } from "bun:test";
import { CodeTreeScanner } from "../src/analyze/codetree.js";

describe("CodeTree Scanner Tests", () => {
  test("Build folder structure tree", () => {
    const scanner = new CodeTreeScanner();
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
    const scanner = new CodeTreeScanner();
    const parsed = scanner.parseFileMetadata(dummyCode);

    expect(parsed.imports).toContain("./helper.js");
    expect(parsed.imports).toContain("typescript");
    expect(parsed.exports.classes[0].name).toBe("Analyzer");
    expect(parsed.exports.classes[0].methods[0].name).toBe("analyze");
    expect(parsed.exports.functions[0].name).toBe("runUtility");
    expect(parsed.exports.interfaces).toContain("Info");
  });


  test("getGitDiff rejects command injection and invalid branch names", () => {
    const scanner = new CodeTreeScanner();
    const result = scanner.getGitDiff("master; rm -rf /");
    expect(result).toBe(
      "Git diff failed: Invalid branch name (must start with alphanumeric).",
    );
  });

  test("scanDependencies recursively parses JS/TS files", () => {
    const scanner = new CodeTreeScanner();
    const results = scanner.scanDependencies("./src/analyze");
    expect(Object.keys(results).length).toBeGreaterThan(0);
    // Find one file we know has imports, like codetree.ts or ast_compressor.ts
    const keys = Object.keys(results);
    const codetreeKey = keys.find((k) => k.endsWith("codetree.ts"));
    if (codetreeKey) {
      expect(results[codetreeKey].imports.length).toBeGreaterThan(0);
      expect(results[codetreeKey].exports.classes.length).toBeGreaterThan(0);
    }
  });

  test("writeCodeIndex generates concise file/function index", () => {
    const scanner = new CodeTreeScanner();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arive-codetree-"));
    const indexPath = path.join(tmpDir, "CODE_INDEX.md");

    // Create a small dummy project
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "utils.ts"),
      `
        import { helper } from "./helper.js";
        export class Analyzer {
          public run() { return true; }
        }
        export function compute(x: number) { return x + 1; }
        export interface Result { ok: boolean; }
      `,
      "utf-8",
    );

    scanner.writeCodeIndex(tmpDir, [], indexPath);

    const content = fs.readFileSync(indexPath, "utf-8");
    expect(content).toContain("Code Index:");
    expect(content).toContain("utils.ts");
    expect(content).toContain("class Analyzer");
    expect(content).toContain("- run()");
    expect(content).toContain("- compute()");
    expect(content).toContain("interface Result");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

