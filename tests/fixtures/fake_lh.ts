#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/** Mirrors the five tools upstream lh-harness 0.1.8 exposes over stdio. */
const TOOLS = [
  "lh_start_run",
  "lh_run_status",
  "lh_stop_run",
  "lh_resume_run",
  "lh_inject_feedback",
].map((name) => ({
  name,
  description: `${name} fixture`,
  inputSchema: {
    type: "object",
    properties: { run_id: { type: "string" }, workspace: { type: "string" } },
  },
}));

const server = new Server(
  { name: "long-horizon-harness", version: "0.1.8" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const payload =
    request.params.name === "lh_start_run"
      ? { success: true, run_id: "run-1", run: { id: "run-1" } }
      : { success: true, run_id: "run-1" };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
});

await server.connect(new StdioServerTransport());
