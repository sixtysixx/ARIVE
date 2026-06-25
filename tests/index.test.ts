import { expect, test, describe } from "bun:test";
import { execSync, spawn } from "child_process";

describe("MCP Entrypoint Shell Run Tests", () => {
  test("TypeScript file compiles", () => {
    // Run TypeScript compiler check
    const compile = execSync("bun x tsc --noEmit", { encoding: "utf-8" });
    expect(compile).toBeDefined();
  });

  test("Spawns MCP Server and processes JSON-RPC requests on stdio", async () => {
    const proc = spawn("bun", ["src/index.ts"]);

    let outputData = "";
    let errorData = "";
    proc.stdout.on("data", (data) => {
      outputData += data.toString();
    });
    proc.stderr.on("data", (data) => {
      errorData += data.toString();
    });

    // Wait for startup log on stderr or a short duration
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (errorData) {
      console.log("SERVER STDERR STARTUP:", errorData);
    }

    // 1. Send List Tools JSON-RPC request
    const listRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    };
    proc.stdin.write(JSON.stringify(listRequest) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 800));
    if (errorData) {
      console.log("SERVER STDERR DURING RUN:", errorData);
    }
    expect(outputData).toContain("arive_compress");
    expect(outputData).toContain("arive_decompress");
    expect(outputData).toContain("arive_codemap");
    outputData = "";

    // 2. Send Call Tool JSON-RPC request for arive_codemap with invalid negative maxDepth
    const invalidDepthRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "arive_codemap",
        arguments: {
          action: "tree",
          maxDepth: -1,
        },
      },
    };
    proc.stdin.write(JSON.stringify(invalidDepthRequest) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(outputData).toContain("isError");
    expect(outputData).toContain("maxDepth");
    outputData = "";

    // 3. Send Call Tool JSON-RPC request for arive_integrate with invalid taskId (path traversal)
    const invalidTaskRequest = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "arive_integrate",
        arguments: {
          action: "execute",
          taskId: "../escaped-path",
        },
      },
    };
    proc.stdin.write(JSON.stringify(invalidTaskRequest) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(outputData).toContain("isError");
    expect(outputData).toContain("Invalid taskId");

    // Clean up process
    proc.kill();
  });
});
