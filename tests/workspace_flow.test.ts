import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface JsonRpcResponse {
  id?: number;
  result?: { isError?: boolean; content?: { text?: string }[] };
  error?: { message?: string };
}

/** Minimal id-matching JSON-RPC client over the MCP stdio transport. */
class McpProbe {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private seq = 0;
  private readonly pending = new Map<number, (value: JsonRpcResponse) => void>();
  private readonly ready: Promise<void>;

  constructor(cwd: string, entry: string, env: Record<string, string> = {}) {
    this.proc = spawn("bun", [entry, "--verbose"], {
      cwd,
      env: { ...process.env, ...env },
    });

    // stderr carries the readiness banner and hook diagnostics; drain it so the
    // child never blocks on a full pipe.
    this.ready = new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        if (chunk.toString().includes("[arive] ready after")) {
          this.proc.stderr.off("data", onData);
          resolve();
        }
      };
      this.proc.stderr.on("data", onData);
      this.proc.on("error", reject);
    });

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        let parsed: JsonRpcResponse;
        try {
          parsed = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }
        if (parsed.id === undefined) continue;
        const resolve = this.pending.get(parsed.id);
        if (resolve) {
          this.pending.delete(parsed.id);
          resolve(parsed);
        }
      }
    });
  }

  private send(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = ++this.seq;
    const { promise, resolve } = Promise.withResolvers<JsonRpcResponse>();
    this.pending.set(id, resolve);
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return promise;
  }

  async start(): Promise<void> {
    await this.ready;
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe", version: "1" },
    });
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const res = await this.send("tools/call", { name, arguments: args });
    return {
      isError: Boolean(res.result?.isError),
      text: res.result?.content?.[0]?.text ?? res.error?.message ?? "",
    };
  }

  /** Kill the server and wait for the process to actually exit. */
  async stop(): Promise<void> {
    if (this.proc.exitCode !== null) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.proc.once("exit", () => resolve());
    this.proc.kill();
    await promise;
  }
}

const ENTRY = path.resolve("src/index.ts");

/**
 * Windows keeps a directory locked while a live process holds it as its cwd, so
 * removal is retried rather than raced against the child's exit.
 */
function removeTree(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** A throwaway project the server can isolate, verify, and hook. */
function makeProject(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "arive-probe", type: "module" }, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "probe.test.ts"),
    `import { expect, test } from "bun:test";\ntest("probe", () => { expect(1).toBe(1); });\n`,
    "utf-8",
  );
  return dir;
}

function writeHook(dir: string, name: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.ts`), body, "utf-8");
}

/** A hook that records that it ran, and in which phase, into `marker`. */
function markerHook(marker: string): string {
  return (
    `import * as fs from "fs";\n` +
    `fs.writeFileSync(${JSON.stringify(marker)}, process.env.ARIVE_HOOK_NAME + "|" + process.env.ARIVE_HOOK_PHASE);\n`
  );
}

const THINK = {
  thought: "probe",
  thoughtNumber: 1,
  totalThoughts: 1,
  nextThoughtNeeded: false,
} as const;

describe("Workspace lifecycle over MCP", () => {
  let project: string;
  let probe: McpProbe;

  beforeAll(async () => {
    project = makeProject("arive-ws-");
    probe = new McpProbe(project, ENTRY);
    await probe.start();
  }, 60000);

  afterAll(async () => {
    await probe.stop();
    removeTree(project);
  });

  test("create → verify → list → cleanup round trip", async () => {
    const created = await probe.call("arive_workspace", {
      action: "create",
      taskId: "flow",
    });
    expect(created.isError).toBe(false);
    expect(created.text).toContain('"status": "created"');
    expect(fs.existsSync(path.join(project, ".arive-tasks", "flow"))).toBe(true);

    const verified = await probe.call("arive_verify", {
      taskId: "flow",
      testCommand: "bun test",
    });
    expect(verified.isError).toBe(false);
    expect(verified.text).toContain('"success": true');

    const listed = await probe.call("arive_workspace", { action: "list" });
    expect(listed.text).toContain('"taskId": "flow"');

    const cleaned = await probe.call("arive_workspace", {
      action: "cleanup",
      taskId: "flow",
    });
    expect(cleaned.isError).toBe(false);
    expect(fs.existsSync(path.join(project, ".arive-tasks", "flow"))).toBe(false);
  }, 60000);

  test("verify backpropagates a failing suite instead of throwing", async () => {
    await probe.call("arive_workspace", { action: "create", taskId: "failing" });
    const res = await probe.call("arive_verify", {
      taskId: "failing",
      testCommand: "bun test missing.test.ts",
    });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('"success": false');
    await probe.call("arive_workspace", { action: "cleanup", taskId: "failing" });
  }, 60000);

  test("verify without a workspace names the tool that creates one", async () => {
    const res = await probe.call("arive_verify", {
      taskId: "absent",
      testCommand: "bun test",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("arive_workspace");
  }, 30000);

  test("rejects a taskId that escapes .arive-tasks", async () => {
    const res = await probe.call("arive_workspace", {
      action: "create",
      taskId: path.join("..", "escaped"),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("traversal");
  }, 30000);

  test("create requires a taskId", async () => {
    const res = await probe.call("arive_workspace", { action: "create" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("taskId");
  }, 30000);
});

describe("Hook discovery", () => {
  test("runs a hook from the project-local .arive/hooks directory", async () => {
    const project = makeProject("arive-hook-local-");
    const marker = path.join(project, "local-ran.txt");
    writeHook(path.join(project, ".arive", "hooks"), "post-reason", markerHook(marker));

    const probe = new McpProbe(project, ENTRY);
    try {
      await probe.start();
      await probe.call("arive_think", THINK);
      expect(fs.existsSync(marker)).toBe(true);
      expect(fs.readFileSync(marker, "utf-8")).toBe("post-reason|reason");
    } finally {
      await probe.stop();
      removeTree(project);
    }
  }, 60000);

  test("$ARIVE_HOOKS_DIR takes priority over the project-local directory", async () => {
    const project = makeProject("arive-hook-override-");
    const localMarker = path.join(project, "local-ran.txt");
    const globalMarker = path.join(project, "global-ran.txt");

    writeHook(path.join(project, ".arive", "hooks"), "post-reason", markerHook(localMarker));
    const globalHooks = path.join(project, "global-hooks");
    writeHook(globalHooks, "post-reason", markerHook(globalMarker));

    const probe = new McpProbe(project, ENTRY, { ARIVE_HOOKS_DIR: globalHooks });
    try {
      await probe.start();
      await probe.call("arive_think", THINK);
      expect(fs.existsSync(globalMarker)).toBe(true);
      expect(fs.existsSync(localMarker)).toBe(false);
    } finally {
      await probe.stop();
      removeTree(project);
    }
  }, 60000);

  test("picks up a hook added after the server started", async () => {
    const project = makeProject("arive-hook-late-");
    const marker = path.join(project, "late-ran.txt");

    const probe = new McpProbe(project, ENTRY);
    try {
      await probe.start();
      // No hook yet — the call must still succeed.
      const before = await probe.call("arive_think", THINK);
      expect(before.isError).toBe(false);

      // A hooks directory created after startup must be discovered, not cached as absent.
      writeHook(path.join(project, ".arive", "hooks"), "post-reason", markerHook(marker));

      await probe.call("arive_think", { ...THINK, thought: "again", thoughtNumber: 2, totalThoughts: 2 });
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      await probe.stop();
      removeTree(project);
    }
  }, 60000);
});
