import * as fs from "fs";
import * as path from "path";
import { CCRRegistry } from "../src/analyze/ccr_registry.js";
import { ContentRouter } from "../src/analyze/content_router.js";
import { SmartCrusher } from "../src/analyze/smart_crusher.js";
import { ASTCompressor } from "../src/analyze/ast_compressor.js";
import { CacheAligner } from "../src/analyze/cache_aligner.js";
import { SequentialEngine } from "../src/reason/sequential_engine.js";
import { WorkspaceManager } from "../src/integrate/workspace.js";

const ITERATIONS = 5;

// Helper to format latency
function fmt(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return `${ms.toFixed(3)}ms`;
}

// Calculate stats for an array of bigint nanoseconds
function getStats(runs: bigint[]): { min: string; max: string; avg: string } {
  let min = runs[0];
  let max = runs[0];
  let sum = 0n;
  for (const r of runs) {
    if (r < min) min = r;
    if (r > max) max = r;
    sum += r;
  }
  const avg = sum / BigInt(runs.length);
  return { min: fmt(min), max: fmt(max), avg: fmt(avg) };
}

async function runBenchmark() {
  console.log("=========================================================");
  console.log("          ARIVE TOOLSET PERFORMANCE BENCHMARKS           ");
  console.log(`          [Executing ${ITERATIONS} Runs Per Benchmark]          `);
  console.log("=========================================================");

  // Initialize DB paths
  const dbPath = ".arive/benchmark_runs_ccr.db";
  const engineDbPath = ".arive/benchmark_runs_engine.db";
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(engineDbPath)) fs.unlinkSync(engineDbPath);

  const registry = new CCRRegistry(dbPath);

  // Sample data load
  const sampleCode = fs.readFileSync(path.resolve("src/cli/installer.ts"), "utf-8");
  const sampleJson = JSON.stringify({
    users: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `User ${i}`, active: i % 2 === 0 })),
    settings: { theme: "dark", notifications: true, tokens: Array.from({ length: 20 }, (_, i) => `token_${i}`) }
  });
  const sampleProse = fs.readFileSync(path.resolve("README.md"), "utf-8");

  // -----------------------------------------------------------------
  // 1. ASTCompressor Benchmark (Code Compression)
  // -----------------------------------------------------------------
  console.log("\n1. ASTCompressor Benchmark...");
  const astRuns: bigint[] = [];
  let astCompressed = "";
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    astCompressed = ASTCompressor.compress(sampleCode);
    astRuns.push(process.hrtime.bigint() - start);
  }
  const astStats = getStats(astRuns);
  const astRatio = ((sampleCode.length - astCompressed.length) / sampleCode.length * 100).toFixed(1);
  console.log(`   - Original:   ${sampleCode.length} chars`);
  console.log(`   - Compressed: ${astCompressed.length} chars (Saved: ${astRatio}%)`);
  console.log(`   - Latency:    Avg: ${astStats.avg} | Min: ${astStats.min} | Max: ${astStats.max}`);

  // -----------------------------------------------------------------
  // 2. SmartCrusher Benchmark (JSON Crush)
  // -----------------------------------------------------------------
  console.log("\n2. SmartCrusher Benchmark...");
  const jsonRuns: bigint[] = [];
  let jsonCompressed = "";
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    jsonCompressed = SmartCrusher.crush(sampleJson);
    jsonRuns.push(process.hrtime.bigint() - start);
  }
  const jsonStats = getStats(jsonRuns);
  const jsonRatio = ((sampleJson.length - jsonCompressed.length) / sampleJson.length * 100).toFixed(1);
  console.log(`   - Original:   ${sampleJson.length} chars`);
  console.log(`   - Compressed: ${jsonCompressed.length} chars (Saved: ${jsonRatio}%)`);
  console.log(`   - Latency:    Avg: ${jsonStats.avg} | Min: ${jsonStats.min} | Max: ${jsonStats.max}`);

  // -----------------------------------------------------------------
  // 3. CacheAligner Benchmark (Prose Normalization)
  // -----------------------------------------------------------------
  console.log("\n3. CacheAligner Benchmark...");
  const proseRuns: bigint[] = [];
  let proseCompressed = "";
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    proseCompressed = CacheAligner.align(sampleProse);
    proseRuns.push(process.hrtime.bigint() - start);
  }
  const proseStats = getStats(proseRuns);
  const proseRatio = ((sampleProse.length - proseCompressed.length) / sampleProse.length * 100).toFixed(1);
  console.log(`   - Original:   ${sampleProse.length} chars`);
  console.log(`   - Compressed: ${proseCompressed.length} chars (Saved: ${proseRatio}%)`);
  console.log(`   - Latency:    Avg: ${proseStats.avg} | Min: ${proseStats.min} | Max: ${proseStats.max}`);

  // -----------------------------------------------------------------
  // 4. CCRRegistry Storage Benchmark (SQLite Writes)
  // -----------------------------------------------------------------
  console.log("\n4. CCRRegistry Storage Benchmark (Writes)...");
  const writeRuns: bigint[] = [];
  let lastHash = "";
  for (let i = 0; i < ITERATIONS; i++) {
    const uniqueContent = `${sampleCode}\n// iteration ${i}`;
    const start = process.hrtime.bigint();
    lastHash = registry.store(uniqueContent, "code");
    writeRuns.push(process.hrtime.bigint() - start);
  }
  const writeStats = getStats(writeRuns);
  console.log(`   - Action:     Stored ${sampleCode.length} chars into DB`);
  console.log(`   - Latency:    Avg: ${writeStats.avg} | Min: ${writeStats.min} | Max: ${writeStats.max}`);

  // -----------------------------------------------------------------
  // 5. CCRRegistry Retrieval Benchmark (SQLite Reads)
  // -----------------------------------------------------------------
  console.log("\n5. CCRRegistry Retrieval Benchmark (Reads)...");
  const readRuns: bigint[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    const result = registry.retrieve(lastHash);
    readRuns.push(process.hrtime.bigint() - start);
    if (!result) throw new Error("Retrieval failed");
  }
  const readStats = getStats(readRuns);
  console.log(`   - Action:     Loaded ${sampleCode.length} chars from DB`);
  console.log(`   - Latency:    Avg: ${readStats.avg} | Min: ${readStats.min} | Max: ${readStats.max}`);

  // -----------------------------------------------------------------
  // 6. SequentialEngine Thought Insertion (SQLite Ledger)
  // -----------------------------------------------------------------
  console.log("\n6. SequentialEngine Thought Insertion Benchmark...");
  const engine = new SequentialEngine(engineDbPath);
  const engineRuns: bigint[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    engine.addThought(`Thought step number ${i}`, i + 1, ITERATIONS, i < ITERATIONS - 1);
    engineRuns.push(process.hrtime.bigint() - start);
  }
  const engineStats = getStats(engineRuns);
  console.log(`   - Action:     Logged thoughts sequentially to DB ledger`);
  console.log(`   - Latency:    Avg: ${engineStats.avg} | Min: ${engineStats.min} | Max: ${engineStats.max}`);

  // -----------------------------------------------------------------
  // 7. Workspace Isolation Benchmark (Worktree Clone & Symlink)
  // -----------------------------------------------------------------
  console.log("\n7. WorkspaceManager Creation Benchmark...");
  const workspaceRuns: bigint[] = [];
  const taskId = "benchmark_workspace_perf";
  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    WorkspaceManager.create(taskId);
    workspaceRuns.push(process.hrtime.bigint() - start);
    WorkspaceManager.cleanup(taskId);
  }
  const workspaceStats = getStats(workspaceRuns);
  console.log(`   - Action:     Created isolated gitignore sandboxes`);
  console.log(`   - Latency:    Avg: ${workspaceStats.avg} | Min: ${workspaceStats.min} | Max: ${workspaceStats.max}`);

  // Cleanups
  registry.close();
  engine.close();

  // Retry loop for unlinking on Windows
  for (let i = 0; i < 20; i++) {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(engineDbPath)) fs.unlinkSync(engineDbPath);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  console.log("\n=========================================================");
  console.log("            ALL BENCHMARKS COMPLETED SUCCESSFULLY        ");
  console.log("=========================================================");
}

runBenchmark().catch(console.error);
