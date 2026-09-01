// fade — OpenCode plugin
import { TOOL_REGISTRY } from "../../src/mcp/tools/index.js";

export default async ({ client } = {}) => {
  const toolNames = Object.keys(TOOL_REGISTRY).join(", ");
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push(`ARIVE MCP ACTIVE: Actively use ARIVE tools (${toolNames}) and follow lazy senior developer rules.`);
    }
  };
};