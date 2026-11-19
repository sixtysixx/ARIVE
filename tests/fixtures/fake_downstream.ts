#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "fake-downstream", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.env.FAKE_LIST_FAIL) throw new Error("list failed");
  return {
    tools: [
      {
        name: "echo",
        description: "Echo the provided text.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      {
        name: "die",
        description: "Exit to simulate a transport failure.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "wait",
        description: "Answer after 200ms.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "wait") {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    return { content: [{ type: "text", text: "done" }] };
  }
  if (request.params.name === "die") {
    // Answer first, then die: the caller sees a transport failure, not a
    // refused call. The delay is configurable so a test can keep requests in
    // flight when the child goes away.
    const dieAfterMs = Number(process.env.FAKE_DIE_MS ?? 5);
    setTimeout(() => process.exit(1), dieAfterMs);
    return { content: [{ type: "text", text: "dying" }] };
  }
  const text = request.params.arguments?.text ?? "";
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ echo: text, from: "fake-downstream" }),
      },
    ],
  };
});

await server.connect(new StdioServerTransport());
