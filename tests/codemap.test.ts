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
});
