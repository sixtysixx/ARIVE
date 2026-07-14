import { expect, test, describe } from "bun:test";
import { execSync, spawn } from "child_process";

/** Send one JSONRPC line to the server and resolve with the first complete response line. */
function rpc(
  proc: ReturnType<typeof spawn>,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  if (!proc.stdout || !proc.stdin) throw new Error("Process has no stdio");

  const { promise, resolve } = Promise.withResolvers<string>();

  let buf = "";
  const onData = (chunk: Buffer) => {
    buf += chunk.toString();
    // JSONRPC responses are newline-delimited.
    const nl = buf.indexOf("\n");
    if (nl !== -1) {
      proc.stdout!.off("data", onData);
      resolve(buf.slice(0, nl));
    }
  };
  proc.stdout.on("data", onData);

  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
  );

  return promise;
}

describe("MCP Entrypoint Shell Run Tests", () => {
  test("TypeScript file compiles without errors", () => {
    // execSync throws on non-zero exit, so reaching the expect means it succeeded.
    try {
      execSync("bun run tsc --noEmit", { encoding: "utf-8" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TypeScript compile failed:\n${msg}`);
    }
  }, 15000);

  test("Spawns MCP Server and processes JSON-RPC requests on stdio", async () => {
    const proc = spawn("bun", ["src/index.ts", "--verbose"]);

    // Wait for the server to signal readiness on stderr — event-driven, no sleep.
    const { promise: ready, resolve: readyResolve } =
      Promise.withResolvers<void>();
    const onStderr = (chunk: Buffer) => {
      if (chunk.toString().includes("[arive] ready after")) {
        proc.stderr!.off("data", onStderr);
        readyResolve();
      }
    };
    proc.stderr!.on("data", onStderr);
    await ready;

    // 1. tools/list — verify arive_memory_bank is advertised.
    const listLine = await rpc(proc, 1, "tools/list", {});
    expect(listLine).toContain("arive_memory_bank");
    expect(listLine).toContain("remember");

    // 2. remember verb — natural-language trigger "remember to buy milk".
    const rememberLine = await rpc(proc, 4, "tools/call", {
      name: "arive_memory_bank",
      arguments: {
        action: "remember",
        content: "remember to buy milk",
      },
    });
    const rememberResp = JSON.parse(rememberLine) as {
      result: { content: { text: string }[] };
    };
    const rememberText = rememberResp.result.content[0].text;
    expect(rememberText).toContain('"status": "remembered"');
    expect(rememberText).toContain('"wing": "user-memories"');

    const idMatch = rememberText.match(/"drawerId":\s*"([^"]+)"/);
    expect(idMatch).not.toBeNull();
    const storedDrawerId = idMatch![1];

    // 3. forget — clean up the stored entry.
    const forgetLine = await rpc(proc, 5, "tools/call", {
      name: "arive_memory_bank",
      arguments: { action: "forget", drawerId: storedDrawerId },
    });
    const forgetResp = JSON.parse(forgetLine) as {
      result: { content: { text: string }[] };
    };
    const forgetText = forgetResp.result.content[0].text;
    expect(forgetText).toContain('"removed": true');

    // 4. arive_explain tool
    const explainLine = await rpc(proc, 6, "tools/call", {
      name: "arive_explain",
      arguments: {
        message: "This is a test message to be formatted.",
        brevity: "lite",
      },
    });
    expect(explainLine).toContain("explanation");
    expect(explainLine).toContain("formatted");

    // 5. arive_compress tool
    const compressLine = await rpc(proc, 7, "tools/call", {
      name: "arive_compress",
      arguments: {
        content: "function test() { console.log('hello'); }",
        contentType: "code",
      },
    });
    expect(compressLine).toContain("compressed");

    proc.kill();
  });

  test("Running with 'prompt' argument prints advanced prompt", () => {
    const output = execSync("bun run src/index.ts prompt", { encoding: "utf-8" });
    expect(output).toContain("ARIVE ADVANCED FRONTIER MODEL ORCHESTRATION PROMPT");
    expect(output).toContain("THE FIVE-PHASE REASONING & INTEGRITY PROTOCOL");
  });

  test("Running with 'install --help' argument prints installer help", () => {
    const output = execSync("bun run src/index.ts install --help", { encoding: "utf-8" });
    expect(output).toContain("ARIVE MCP Installer/Uninstaller CLI");
    expect(output).toContain("Usage:");
    expect(output).toContain("--editor, -e <name>");
  });

  test("Running with 'installer --help' argument prints installer help", () => {
    const output = execSync("bun run src/index.ts installer --help", { encoding: "utf-8" });
    expect(output).toContain("ARIVE MCP Installer/Uninstaller CLI");
    expect(output).toContain("Usage:");
    expect(output).toContain("--editor, -e <name>");
  });
});
