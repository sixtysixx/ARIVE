import * as fs from "fs";
import * as path from "path";

const ITERATIONS = 3;
const API_URL = "https://opencode.ai/zen/v1/chat/completions";
const MODEL_NAME = "mimo-v2.5-free";
const TASK = "Develop and integrate promptfoo benchmarks for ARIVE. Do not ask for clarification. Assume a standard workspace and execute all 5 phases of the reasoning protocol in your response immediately.";

interface RunResult {
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  output: string;
  assertions: {
    scopeGate: boolean;
    evidenceGate: boolean;
    challengeGate: boolean;
    verificationGate: boolean;
    reportGate: boolean;
    noGreeting: boolean;
    noEmoji: boolean;
  };
  passed: boolean;
}

// Query the Xiaomi mimo-v2.5-free model
async function queryModel(prompt: string): Promise<{ output: string; usage: any; latencyMs: number }> {
  const start = Date.now();
  const body = JSON.stringify({
    model: MODEL_NAME,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }]
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer public"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`API returned status ${response.status}: ${await response.text()}`);
  }

  const json = await response.json() as any;
  const latencyMs = Date.now() - start;
  const output = String(json.choices[0].message.content || "");
  const usage = json.usage || { prompt_tokens: 0, completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } };

  return { output, usage, latencyMs };
}

// Evaluate assertions on model output
function evaluateOutput(output: string): RunResult["assertions"] {
  const lower = output.toLowerCase();
  
  // Gate check (flexible case-insensitive substring matches)
  const scopeGate = lower.includes("scope gate");
  const evidenceGate = lower.includes("evidence gate");
  const challengeGate = lower.includes("challenge gate");
  const verificationGate = lower.includes("verification gate");
  const reportGate = lower.includes("report gate");

  // Tone check
  const noGreeting = !lower.includes("hey there") && !lower.includes("hi there");
  const noEmoji = !lower.includes("🚀") && !output.includes("😊") && !output.includes("🎉");

  return {
    scopeGate,
    evidenceGate,
    challengeGate,
    verificationGate,
    reportGate,
    noGreeting,
    noEmoji
  };
}

async function runPromptBenchmark(promptPath: string, label: string): Promise<RunResult[]> {
  console.log(`\nEvaluating prompt: ${label} (${promptPath})...`);
  const template = fs.readFileSync(path.resolve(promptPath), "utf-8");
  const prompt = template.replace("{{task}}", TASK);

  const results: RunResult[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    process.stdout.write(`   Run #${i + 1}/${ITERATIONS} ... `);
    try {
      const { output, usage, latencyMs } = await queryModel(prompt);
      const assertions = evaluateOutput(output);
      
      const passed = assertions.scopeGate && 
                     assertions.evidenceGate && 
                     assertions.challengeGate && 
                     assertions.verificationGate && 
                     assertions.reportGate && 
                     assertions.noGreeting && 
                     assertions.noEmoji;

      results.push({
        latencyMs,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
        output,
        assertions,
        passed
      });
      console.log(passed ? "PASS" : "FAIL");
    } catch (err: any) {
      console.log(`ERROR (${err.message})`);
    }
  }

  return results;
}

function printStats(label: string, runs: RunResult[]) {
  const count = runs.length;
  if (count === 0) {
    console.log(`No results for ${label}`);
    return;
  }

  const passedCount = runs.filter(r => r.passed).length;
  const avgLatency = runs.reduce((acc, r) => acc + r.latencyMs, 0) / count;
  const avgPromptTokens = runs.reduce((acc, r) => acc + r.promptTokens, 0) / count;
  const avgCompletionTokens = runs.reduce((acc, r) => acc + r.completionTokens, 0) / count;
  const avgReasoningTokens = runs.reduce((acc, r) => acc + r.reasoningTokens, 0) / count;

  const scopePasses = runs.filter(r => r.assertions.scopeGate).length;
  const evidencePasses = runs.filter(r => r.assertions.evidenceGate).length;
  const challengePasses = runs.filter(r => r.assertions.challengeGate).length;
  const verifyPasses = runs.filter(r => r.assertions.verificationGate).length;
  const reportPasses = runs.filter(r => r.assertions.reportGate).length;
  const greetingPasses = runs.filter(r => r.assertions.noGreeting).length;
  const emojiPasses = runs.filter(r => r.assertions.noEmoji).length;

  console.log(`\n=========================================================`);
  console.log(`📊 STATISTICS FOR: ${label.toUpperCase()}`);
  console.log(`=========================================================`);
  console.log(`- Overall Pass Rate:      ${passedCount}/${count} (${(passedCount / count * 100).toFixed(1)}%)`);
  console.log(`- Avg Latency:            ${(avgLatency / 1000).toFixed(2)}s`);
  console.log(`- Avg Prompt Tokens:      ${avgPromptTokens.toFixed(0)}`);
  console.log(`- Avg Completion Tokens:  ${avgCompletionTokens.toFixed(0)} (Reasoning: ${avgReasoningTokens.toFixed(0)})`);
  console.log(`\nAssertion Pass Rates:`);
  console.log(`- SCOPE GATE:             ${scopePasses}/${count} (${(scopePasses / count * 100).toFixed(1)}%)`);
  console.log(`- EVIDENCE GATE:          ${evidencePasses}/${count} (${(evidencePasses / count * 100).toFixed(1)}%)`);
  console.log(`- CHALLENGE GATE:         ${challengePasses}/${count} (${(challengePasses / count * 100).toFixed(1)}%)`);
  console.log(`- VERIFICATION GATE:      ${verifyPasses}/${count} (${(verifyPasses / count * 100).toFixed(1)}%)`);
  console.log(`- REPORT GATE:            ${reportPasses}/${count} (${(reportPasses / count * 100).toFixed(1)}%)`);
  console.log(`- No Informal Greetings:  ${greetingPasses}/${count} (${(greetingPasses / count * 100).toFixed(1)}%)`);
  console.log(`- No Emojis:              ${emojiPasses}/${count} (${(emojiPasses / count * 100).toFixed(1)}%)`);
}

async function main() {
  console.log("=========================================================");
  console.log("          ARIVE MULTI-RUN PROMPT EVALUATION              ");
  console.log(`          Model: ${MODEL_NAME} | ${ITERATIONS} Runs Each           `);
  console.log("=========================================================");

  // Ensure prompts are generated
  const cp = require("child_process");
  cp.spawnSync("bun", ["run", "scripts/prepare_prompt.ts"], { stdio: "inherit" });

  const ariveRuns = await runPromptBenchmark("arive_prompt.txt", "ARIVE Prompt (With MCP)");
  const baselineRuns = await runPromptBenchmark("baseline_prompt.txt", "Baseline Prompt (Without MCP)");

  printStats("ARIVE Prompt (With MCP)", ariveRuns);
  printStats("Baseline Prompt (Without MCP)", baselineRuns);

  console.log("\n=========================================================");
  console.log("            ALL EVALUATIONS COMPLETED SUCCESSFULLY       ");
  console.log("=========================================================");
}

main().catch(console.error);
