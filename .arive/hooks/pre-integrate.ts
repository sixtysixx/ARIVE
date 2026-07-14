import * as fs from "fs";
import * as path from "path";
import { CodeTreeScanner } from "../../src/analyze/codetree.js";

interface HookContext {
  taskId: string;
  action: "create" | "execute" | "cleanup" | string;
  branchName?: string;
  command?: string;
}

interface FileState {
  imports: string[];
  classes: { name: string; methods: string[] }[];
  functions: string[];
  interfaces: string[];
}

function parseCodeIndex(content: string): Map<string, FileState> {
  const fileStates = new Map<string, FileState>();
  const detailsRegex = /<details>([\s\S]*?)<\/details>/g;
  let match: RegExpExecArray | null;
  while ((match = detailsRegex.exec(content)) !== null) {
    const detailsBody = match[1];
    const fileMatch = detailsBody.match(/<summary>📄 <code>(.*?)<\/code><\/summary>/);
    if (!fileMatch) continue;
    const filePath = fileMatch[1].trim();

    const importsMatch = detailsBody.match(/Imports:\s*(.*)/);
    const imports = importsMatch && importsMatch[1].trim()
      ? importsMatch[1].split(",").map(i => i.trim())
      : [];

    const classes: { name: string; methods: string[] }[] = [];
    const functions: string[] = [];
    const interfaces: string[] = [];

    const lines = detailsBody.split("\n");
    let currentClass: { name: string; methods: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- class ")) {
        const className = trimmed.replace("- class ", "").trim();
        currentClass = { name: className, methods: [] };
        classes.push(currentClass);
      } else if (trimmed.startsWith("- ") && trimmed.endsWith("()")) {
        const fnName = trimmed.slice(2).trim();
        functions.push(fnName);
        currentClass = null;
      } else if (trimmed.startsWith("- interface ")) {
        const ifaceName = trimmed.replace("- interface ", "").trim();
        interfaces.push(ifaceName);
        currentClass = null;
      } else if (trimmed.startsWith("- ") && trimmed.startsWith("  - ") === false) {
        currentClass = null;
      } else if (line.startsWith("  - ") || line.startsWith("    - ")) {
        if (currentClass) {
          const methodName = trimmed.replace("- ", "").trim();
          currentClass.methods.push(methodName);
        }
      }
    }

    fileStates.set(filePath, { imports, classes, functions, interfaces });
  }
  return fileStates;
}

async function run(): Promise<void> {
  const contextRaw = process.env.ARIVE_HOOK_CONTEXT || "{}";
  let context: HookContext;
  try {
    context = JSON.parse(contextRaw) as HookContext;
  } catch {
    context = { taskId: "", action: "" };
  }

  const { action, taskId } = context;

  // We only run analysis on create or execute
  if (action !== "create" && action !== "execute") {
    process.exit(0);
  }

  console.log(`[pre-integrate] Hook started for task: ${taskId}, action: ${action}`);

  let scanDir = ".";
  let indexPath = "";

  if (fs.existsSync("src")) {
    scanDir = "src";
    indexPath = "src/.arive/CODE_INDEX.md";
  } else {
    indexPath = ".arive/CODE_INDEX.md";
  }

  const absoluteIndexPath = path.resolve(indexPath);

  // Generate codetree if it does not exist
  if (!fs.existsSync(absoluteIndexPath)) {
    console.log(`[pre-integrate] Codetree index not found at ${indexPath}. Generating new one...`);
    const scanner = new CodeTreeScanner();
    scanner.writeCodeIndex(scanDir, [], absoluteIndexPath);
  }

  // Analyze the codemap
  try {
    const content = fs.readFileSync(absoluteIndexPath, "utf-8");
    const fileStates = parseCodeIndex(content);

    const totalFiles = fileStates.size;
    let totalClasses = 0;
    let totalMethods = 0;
    let totalFunctions = 0;
    let totalInterfaces = 0;

    for (const state of fileStates.values()) {
      totalClasses += state.classes.length;
      totalFunctions += state.functions.length;
      totalInterfaces += state.interfaces.length;
      for (const cls of state.classes) {
        totalMethods += cls.methods.length;
      }
    }

    console.log(`[pre-integrate] Codemap analysis completed successfully!`);
    console.log(`  - Total Files: ${totalFiles}`);
    console.log(`  - Total Classes: ${totalClasses}`);
    console.log(`  - Total Methods: ${totalMethods}`);
    console.log(`  - Total Functions: ${totalFunctions}`);
    console.log(`  - Total Interfaces: ${totalInterfaces}`);

  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[pre-integrate] Warning: Failed to parse or analyze codemap: ${errMsg}`);
  }
}

run().catch((err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(errMsg);
  process.exit(1);
});