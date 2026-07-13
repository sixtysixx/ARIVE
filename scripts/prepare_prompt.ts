import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

console.log("Generating advanced prompt using bun run prompt...");

const result = spawnSync("bun", ["run", "src/index.ts", "prompt"], {
  encoding: "utf-8",
});

if (result.error) {
  console.error("Failed to generate advanced prompt:", result.error);
  process.exit(1);
}

const promptText = result.stdout;

// Locate the start of the advanced prompt (ignoring any debug/info output before the first line of equals)
const borderIndex = promptText.indexOf("================================================================================");
let cleanPrompt = promptText;
if (borderIndex !== -1) {
  cleanPrompt = promptText.substring(borderIndex);
}

const ariveTemplate = `${cleanPrompt.trim()}\n\nTask: {{task}}\nResponse:`;
const baselineTemplate = `You are a helpful AI assistant.\n\nTask: {{task}}\nResponse:`;

fs.writeFileSync(path.join(process.cwd(), "arive_prompt.txt"), ariveTemplate, "utf-8");
fs.writeFileSync(path.join(process.cwd(), "baseline_prompt.txt"), baselineTemplate, "utf-8");

console.log("Successfully generated arive_prompt.txt and baseline_prompt.txt");
