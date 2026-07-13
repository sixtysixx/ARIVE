import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const preCommitScript = `#!/bin/sh
# ARIVE pre-commit hook
echo "Executing pre-commit compiling and testing verification checks..."
bun x tsc --noEmit
if [ $? -ne 0 ]; then
  echo "❌ Compilation failed. Commit aborted."
  exit 1
fi

bun test
if [ $? -ne 0 ]; then
  echo "❌ Test suite failed. Commit aborted."
  exit 1
fi

echo "✅ Checks passed. Proceeding with commit."
exit 0
`;

/**
 * Helper to write a hook file and handle conflicts (overwrite, append, skip).
 */
export function writeHookFileWithConflict(
  hookFile: string,
  action: "overwrite" | "append" | "skip"
): void {
  if (!fs.existsSync(hookFile)) {
    fs.writeFileSync(hookFile, preCommitScript, { encoding: "utf-8", mode: 0o755 });
    console.log("Git pre-commit verification hooks installed successfully!");
    return;
  }

  if (action === "overwrite") {
    fs.writeFileSync(hookFile, preCommitScript, { encoding: "utf-8", mode: 0o755 });
    console.log("Git pre-commit verification hooks overwritten successfully!");
  } else if (action === "append") {
    const current = fs.readFileSync(hookFile, "utf-8");
    if (!current.includes("ARIVE pre-commit")) {
      const appended = `${current}\n# Added by ARIVE\n${preCommitScript.replace("#!/bin/sh\n", "")}`;
      fs.writeFileSync(hookFile, appended, { encoding: "utf-8", mode: 0o755 });
      console.log("Git pre-commit verification hooks appended successfully!");
    } else {
      console.log("ℹ Git pre-commit hook already contains ARIVE checks.");
    }
  } else {
    console.log("ℹ Skipped pre-commit hook modification.");
  }
}

/**
 * Synchronous pre-commit hook installation for non-interactive/test environments.
 */
export function installPreCommitHookSync(workspacePath?: string): void {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  const gitDir = path.join(wsRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    console.log("ℹ Not a Git repository, skipping Git hook installation.");
    return;
  }

  const hooksDir = path.join(gitDir, "hooks");
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, "pre-commit");
  writeHookFileWithConflict(hookFile, "append");
}

/**
 * Asynchronous pre-commit hook installation that prompts the user if interactive.
 */
export async function installPreCommitHook(workspacePath?: string): Promise<void> {
  const wsRoot = workspacePath ? path.resolve(workspacePath) : process.cwd();
  const gitDir = path.join(wsRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    console.log("ℹ Not a Git repository, skipping Git hook installation.");
    return;
  }

  const hooksDir = path.join(gitDir, "hooks");
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, "pre-commit");
  const isInteractive = process.stdout.isTTY && !process.env.CI && !process.argv.includes("--non-interactive");

  if (fs.existsSync(hookFile)) {
    let action = "append";
    if (isInteractive) {
      const { promise, resolve } = Promise.withResolvers<string>();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        `Git pre-commit hook already exists at ${hookFile}.\nDo you want to: [o]verwrite, [a]ppend, or [s]kip? [default: append]: `,
        (ans) => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        }
      );
      const answer = await promise;
      if (answer === "o" || answer === "overwrite") {
        action = "overwrite";
      } else if (answer === "s" || answer === "skip") {
        action = "skip";
      }
    } else {
      const current = fs.readFileSync(hookFile, "utf-8");
      if (current.includes("ARIVE pre-commit")) {
        action = "skip";
      }
    }

    writeHookFileWithConflict(hookFile, action as "overwrite" | "append" | "skip");
  } else {
    if (isInteractive) {
      const { promise, resolve } = Promise.withResolvers<string>();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        "Would you like to install Git pre-commit verification hooks? (y/n) [default: y]: ",
        (ans) => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        }
      );
      const answer = await promise;
      if (answer === "n" || answer === "no") {
        console.log("ℹ Skipped pre-commit hook installation.");
        return;
      }
    }
    writeHookFileWithConflict(hookFile, "overwrite");
  }
}

// Executed directly if run via CLI
if (import.meta.path === Bun.main) {
  installPreCommitHook().catch((err) => {
    console.error("Installation failed:", err);
    process.exit(1);
  });
}
