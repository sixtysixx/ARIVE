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

  // We only run update on execute action
  if (action !== "execute") {
    process.exit(0);
  }

  console.log(`[post-integrate] Hook started for task: ${taskId}, action: ${action}`);

  let projectScanDir = ".";
  let indexPath = "";

  if (fs.existsSync("src")) {
    projectScanDir = "src";
    indexPath = "src/.arive/CODE_INDEX.md";
  } else {
    indexPath = ".arive/CODE_INDEX.md";
  }

  const absoluteIndexPath = path.resolve(indexPath);

  // 1. Determine where to scan for the new state
  let workspaceScanDir = projectScanDir;
  const workspacePath = path.resolve(".arive-tasks", taskId);
  const workspaceSpecificScanDir = path.join(workspacePath, projectScanDir);

  if (fs.existsSync(workspaceSpecificScanDir)) {
    workspaceScanDir = workspaceSpecificScanDir;
  } else if (fs.existsSync(workspacePath)) {
    workspaceScanDir = workspacePath;
  }

  console.log(`[post-integrate] Workspace scan directory identified: ${workspaceScanDir}`);

  // 2. Parse the old codemap (if exists)
  let oldStates = new Map<string, FileState>();
  if (fs.existsSync(absoluteIndexPath)) {
    try {
      const oldContent = fs.readFileSync(absoluteIndexPath, "utf-8");
      oldStates = parseCodeIndex(oldContent);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[post-integrate] Warning: Failed to parse old codemap: ${errMsg}`);
    }
  }

  // 3. Generate the updated codetree from workspace
  console.log(`[post-integrate] Updating codetree index at ${indexPath}...`);
  const scanner = new CodeTreeScanner();
  scanner.writeCodeIndex(workspaceScanDir, [], absoluteIndexPath);

  // 4. Parse the new codemap
  let newStates = new Map<string, FileState>();
  if (fs.existsSync(absoluteIndexPath)) {
    try {
      const newContent = fs.readFileSync(absoluteIndexPath, "utf-8");
      newStates = parseCodeIndex(newContent);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[post-integrate] Error: Failed to parse updated codemap: ${errMsg}`);
      process.exit(1);
    }
  }

  // 5. Compare old and new states and output updates
  const diffs: string[] = [];

  for (const [file, newState] of newStates.entries()) {
    const oldState = oldStates.get(file);
    if (!oldState) {
      diffs.push(`  [Added File] ${file}`);
      continue;
    }

    // Compare functions
    const addedFns = newState.functions.filter(f => !oldState.functions.includes(f));
    const removedFns = oldState.functions.filter(f => !newState.functions.includes(f));
    for (const f of addedFns) diffs.push(`  [Added Function] ${file} -> ${f}()`);
    for (const f of removedFns) diffs.push(`  [Removed Function] ${file} -> ${f}()`);

    // Compare classes
    for (const newCls of newState.classes) {
      const oldCls = oldState.classes.find(c => c.name === newCls.name);
      if (!oldCls) {
        diffs.push(`  [Added Class] ${file} -> class ${newCls.name}`);
        for (const m of newCls.methods) {
          diffs.push(`  [Added Method] ${file} -> class ${newCls.name} -> ${m}()`);
        }
      } else {
        const addedMethods = newCls.methods.filter(m => !oldCls.methods.includes(m));
        const removedMethods = oldCls.methods.filter(m => !newCls.methods.includes(m));
        for (const m of addedMethods) {
          diffs.push(`  [Added Method] ${file} -> class ${newCls.name} -> ${m}()`);
        }
        for (const m of removedMethods) {
          diffs.push(`  [Removed Method] ${file} -> class ${newCls.name} -> ${m}()`);
        }
      }
    }

    for (const oldCls of oldState.classes) {
      const newCls = newState.classes.find(c => c.name === oldCls.name);
      if (!newCls) {
        diffs.push(`  [Removed Class] ${file} -> class ${oldCls.name}`);
      }
    }

    // Compare interfaces
    const addedIfaces = newState.interfaces.filter(i => !oldState.interfaces.includes(i));
    const removedIfaces = oldState.interfaces.filter(i => !newState.interfaces.includes(i));
    for (const i of addedIfaces) diffs.push(`  [Added Interface] ${file} -> interface ${i}`);
    for (const i of removedIfaces) diffs.push(`  [Removed Interface] ${file} -> interface ${i}`);
  }

  for (const file of oldStates.keys()) {
    if (!newStates.has(file)) {
      diffs.push(`  [Removed File] ${file}`);
    }
  }

  if (diffs.length > 0) {
    console.log(`[post-integrate] Codetree updates detected successfully:`);
    diffs.forEach(d => console.log(d));
  } else {
    console.log(`[post-integrate] No codetree differences detected (functions/methods match).`);
  }
}

run().catch((err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(errMsg);
  process.exit(1);
});