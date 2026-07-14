import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { HookManager } from "../src/integrate/hook_manager.js";
import { WorkspaceManager } from "../src/integrate/workspace.js";
import * as fs from "fs";
import * as path from "path";

describe("Codetree Integrate Hooks Tests", () => {
  const taskId = "hook_test_task";
  let workspacePath: string;
  let backupIndexExists = false;
  let backupIndexContent = "";
  let indexPath = "";

  beforeAll(() => {
    // Determine index path based on project setup
    if (fs.existsSync("src")) {
      indexPath = "src/.arive/CODE_INDEX.md";
    } else {
      indexPath = ".arive/CODE_INDEX.md";
    }

    // Backup existing CODE_INDEX.md if it exists
    if (fs.existsSync(indexPath)) {
      backupIndexExists = true;
      backupIndexContent = fs.readFileSync(indexPath, "utf-8");
      fs.unlinkSync(indexPath);
    }

    // Determine workspace path
    workspacePath = WorkspaceManager.getTaskPath(taskId);
  });

  afterAll(() => {
    // Restore backed up CODE_INDEX.md
    if (fs.existsSync(indexPath)) {
      fs.unlinkSync(indexPath);
    }
    if (backupIndexExists) {
      fs.writeFileSync(indexPath, backupIndexContent, "utf-8");
    }

    // Clean up task workspace
    WorkspaceManager.cleanup(taskId);
  });

  test("1. pre-integrate generates codetree if missing and analyzes successfully", () => {
    expect(fs.existsSync(indexPath)).toBe(false);

    // Run the pre-integrate hook
    const context = { taskId, action: "create" };
    const res = HookManager.runHook("pre-integrate", "integrate", context);

    expect(res.success).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);

    const content = fs.readFileSync(indexPath, "utf-8");
    expect(content).toContain("Code Index:");
  });

  test("2. post-integrate updates functions/methods from workspace and diffs successfully", () => {
    // 1. Create workspace
    WorkspaceManager.create(taskId);

    // Verify workspace path exists and has source files
    const workspaceSrcDir = path.join(workspacePath, "src");
    expect(fs.existsSync(workspaceSrcDir)).toBe(true);

    // 2. Modify a file in the workspace to add a new function
    const targetFileInWorkspace = path.join(workspaceSrcDir, "cli", "prompt_generator.ts");
    expect(fs.existsSync(targetFileInWorkspace)).toBe(true);

    const originalContent = fs.readFileSync(targetFileInWorkspace, "utf-8");
    // Append a new function to the workspace file
    const modifiedContent = `${originalContent}\nexport function testHookHookAddition() {}\n`;
    fs.writeFileSync(targetFileInWorkspace, modifiedContent, "utf-8");

    // 3. Run post-integrate hook for 'execute' action
    const context = { taskId, action: "execute" };
    const res = HookManager.runHook("post-integrate", "integrate", context);

    expect(res.success).toBe(true);

    // 4. Verify the new function is now indexed in CODE_INDEX.md
    const updatedContent = fs.readFileSync(indexPath, "utf-8");
    expect(updatedContent).toContain("testHookHookAddition()");
  });
});