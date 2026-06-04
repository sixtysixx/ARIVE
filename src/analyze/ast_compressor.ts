import ts from "typescript";

export class ASTCompressor {
  public static compress(code: string): string {
    try {
      const sourceFile = ts.createSourceFile(
        "temp.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      return this.printNodeMinified(sourceFile, sourceFile).trim();
    } catch (e) {
      return code;
    }
  }

  private static printNodeMinified(node: ts.Node, sourceFile: ts.SourceFile): string {
    const printer = ts.createPrinter({
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed
    });

    const result = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
    
    // Minimize blank lines & formatting whitespace runs
    return result
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join("\n");
  }
}
