import * as fs from "fs";
import * as path from "path";

export function installPreCommitHook() {
  const gitDir = path.resolve(".git");
  if (!fs.existsSync(gitDir)) {
    console.error("Error: Not a Git repository (could not find .git folder)");
    process.exit(1);
  }

  const hooksDir = path.join(gitDir, "hooks");
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, "pre-commit");
  const script = `#!/bin/sh
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

  fs.writeFileSync(hookFile, script, { encoding: "utf-8", mode: 0o755 });
  console.log("Git pre-commit verification hooks installed successfully!");
}

// Executed directly if run via CLI
if (import.meta.path === Bun.main) {
  installPreCommitHook();
}
