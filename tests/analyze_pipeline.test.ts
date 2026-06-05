import { expect, test, describe } from "bun:test";
import { ContentRouter } from "../src/analyze/content_router.js";
import { SmartCrusher } from "../src/analyze/smart_crusher.js";
import { ASTCompressor } from "../src/analyze/ast_compressor.js";
import { CacheAligner } from "../src/analyze/cache_aligner.js";

describe("Analyze Pipeline Tests", () => {
  test("Content Router classification", () => {
    expect(ContentRouter.classify("{ \"a\": 1 }")).toBe("json");
    expect(ContentRouter.classify("function test() { console.log('hi'); }")).toBe("code");
    expect(ContentRouter.classify("This is just standard prose writing.")).toBe("prose");
  });

  test("Smart Crusher JSON array flattening", () => {
    const rawJson = JSON.stringify({
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
        { id: 4, name: "Dave" }
      ],
      errors: { message: "Internal Failure", code: 500 }
    });
    const crushed = SmartCrusher.crush(rawJson);
    const parsed = JSON.parse(crushed);
    expect(parsed.users.length).toBe(3); // 2 elements + 1 descriptor string
    expect(parsed.users[2]).toContain("truncated 2 items");
    expect(parsed.errors.message).toBe("Internal Failure");
  });

  test("AST Compressor comment and JSDoc stripping", () => {
    const rawCode = `
      /**
       * This is JSDoc
       */
      function run(x: number) {
        // Single-line comment
        const y = x * 2; /* Inline comment */
        return y;
      }
    `;
    const compressed = ASTCompressor.compress(rawCode);
    expect(compressed).not.toContain("JSDoc");
    expect(compressed).not.toContain("Single-line comment");
    expect(compressed).not.toContain("Inline comment");
    expect(compressed.replace(/\s/g, "")).toContain("functionrun(x:number){consty=x*2;returny;}");
  });

  test("Cache Aligner normalizes content whitespace", () => {
    const prompt = "  Line 1   \r\n\r\n   Line 2 \n ";
    expect(CacheAligner.align(prompt)).toBe("Line 1\nLine 2");
  });

  describe("Multi-Language Compression", () => {
    test("Compresses Python code comments and docstrings", () => {
      const pythonRaw = `def add(a, b):
    \"\"\"This is a docstring
    with multiple lines\"\"\"
    # Inline comment
    return a + b  # inline addition`;
      const compressed = ASTCompressor.compressMultiLanguage(pythonRaw, "python");
      expect(compressed.includes("docstring")).toBe(false);
      expect(compressed.includes("Inline comment")).toBe(false);
      expect(compressed.trim()).toBe("def add(a, b):\n    return a + b");
    });

    test("Compresses Go/Rust/C++ comments", () => {
      const rustRaw = `fn main() {
    /* Block comment
       spanning multiple lines */
    let x = 5; // inline comment
    println!("{}", x);
}`;
      const compressed = ASTCompressor.compressMultiLanguage(rustRaw, "rust");
      expect(compressed.includes("Block comment")).toBe(false);
      expect(compressed.includes("inline comment")).toBe(false);
      expect(compressed.includes("x = 5")).toBe(true);
    });
  });
});
