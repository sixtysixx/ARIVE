import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { executeInstallation, executeUninstallation } from "./installer.js";

const ACTIONS = ["install", "uninstall"] as const;
const EDITORS = [
  "all",
  "cursor",
  "cline",
  "roo",
  "windsurf",
  "opencode",
  "kilocode",
  "claude",
  "claudecode",
  "antigravity",
  "omp",
] as const;
const SCOPES = ["both", "project", "global"] as const;
const CONFLICTS = ["overwrite", "append", "skip"] as const;
const GITIGNORE_OPTS = [true, false] as const;

export async function runTui(): Promise<void> {
  let activeRow = 0; // 0 to 6
  let actionIdx = 0;
  let editorIdx = 0;
  let scopeIdx = 0;
  let conflictIdx = 1; // Default to 'append'
  let gitignoreIdx = 0; // Default to true

  // Hide cursor, clear screen, and configure raw TTY mode
  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[2J\x1b[H");

  const cleanup = () => {
    process.stdout.write("\x1b[?25h");
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      // Ignore errors resetting stdin mode
    }
  };

  const render = () => {
    // Clear screen and draw menu from top
    process.stdout.write("\x1b[H");
    let output = "";
    output += `\x1b[1m\x1b[36m=== ARIVE MCP Interactive Configurator TUI ===\x1b[0m\n\n`;
    output += `Use ↑/↓ to navigate rows.\n`;
    output += `Use ←/→ (or Space) to cycle values on the selected option.\n`;
    output += `Press Enter on [ RUN EXECUTION ] to apply changes.\n\n`;

    const drawRow = (rowIdx: number, label: string, value: string) => {
      if (rowIdx === activeRow) {
        return `  \x1b[36m\x1b[1m▸ ${label.padEnd(22)} < ${value} >\x1b[0m\n`;
      } else {
        return `    \x1b[90m${label.padEnd(22)}   ${value}\x1b[0m\n`;
      }
    };

    output += drawRow(0, "Action:", ACTIONS[actionIdx].toUpperCase());
    output += drawRow(1, "Editor/Agent Target:", EDITORS[editorIdx]);
    output += drawRow(2, "Install Scope:", SCOPES[scopeIdx]);
    output += drawRow(3, "Conflict Policy:", CONFLICTS[conflictIdx]);
    output += drawRow(4, "Gitignore update:", GITIGNORE_OPTS[gitignoreIdx] ? "Yes" : "No");
    output += `\n`;

    if (activeRow === 5) {
      output += `  \x1b[32m\x1b[1m▸ [ RUN EXECUTION ]\x1b[0m\n`;
    } else {
      output += `    \x1b[32m[ RUN EXECUTION ]\x1b[0m\n`;
    }

    if (activeRow === 6) {
      output += `  \x1b[31m\x1b[1m▸ [ EXIT ]\x1b[0m\n`;
    } else {
      output += `    \x1b[31m[ EXIT ]\x1b[0m\n`;
    }

    process.stdout.write(output);
  };


  return new Promise<void>((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // Ignore
      }
    }
    process.stdin.resume();

    const cleanup = () => {
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // Ignore
        }
      }
    };

    render();

    const changeValue = (forward: boolean) => {
      const delta = forward ? 1 : -1;
      if (activeRow === 0) {
        actionIdx = (actionIdx + delta + ACTIONS.length) % ACTIONS.length;
      } else if (activeRow === 1) {
        editorIdx = (editorIdx + delta + EDITORS.length) % EDITORS.length;
      } else if (activeRow === 2) {
        scopeIdx = (scopeIdx + delta + SCOPES.length) % SCOPES.length;
      } else if (activeRow === 3) {
        conflictIdx = (conflictIdx + delta + CONFLICTS.length) % CONFLICTS.length;
      } else if (activeRow === 4) {
        gitignoreIdx = (gitignoreIdx + delta + GITIGNORE_OPTS.length) % GITIGNORE_OPTS.length;
      }
      render();
    };

    const onKeypress = (str: string | undefined, key: readline.Key) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        process.stdout.write("\n\x1b[31mOperation cancelled.\x1b[0m\n");
        resolve();
        return;
      }

      if (key.name === "up" || str === "k") {
        activeRow = (activeRow - 1 + 7) % 7;
        render();
        return;
      }
      if (key.name === "down" || str === "j") {
        activeRow = (activeRow + 1) % 7;
        render();
        return;
      }

      if (key.name === "right" || key.name === "space" || str === "l") {
        changeValue(true);
        return;
      }
      if (key.name === "left" || str === "h") {
        changeValue(false);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (activeRow === 5) {
          cleanup();
          process.stdout.write("\x1b[2J\x1b[H");

          const action = ACTIONS[actionIdx];
          const editor = EDITORS[editorIdx] === "all" ? undefined : EDITORS[editorIdx];
          const scope = SCOPES[scopeIdx];
          const conflict = CONFLICTS[conflictIdx];
          const gitignore = GITIGNORE_OPTS[gitignoreIdx];

          console.log(`\x1b[1m\x1b[36mApplying configuration:\x1b[0m`);
          console.log(`  - Action: ${action.toUpperCase()}`);
          console.log(`  - Target Editor: ${editor || "All"}`);
          console.log(`  - Scope: ${scope}`);
          console.log(`  - Conflict Policy: ${conflict}`);
          console.log(`  - Update Gitignore: ${gitignore ? "Yes" : "No"}`);
          console.log("");

          try {
            if (action === "install") {
              executeInstallation(process.cwd(), {
                target: editor,
                updateGitignore: gitignore,
                ruleConflictAction: conflict,
                scope: scope,
              });
            } else {
              executeUninstallation(process.cwd(), {
                target: editor,
                updateGitignore: gitignore,
                ruleConflictAction: conflict,
                scope: scope,
              });
            }
            console.log("\n\x1b[32m✓ TUI operation completed successfully.\x1b[0m");
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`\n\x1b[31m! Error executing: ${message}\x1b[0m`);
          }
          resolve();
        } else if (activeRow === 6) {
          cleanup();
          process.stdout.write("\x1b[2J\x1b[H");
          resolve();
        }
        return;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}