// fade — OpenCode plugin
export default async ({ client } = {}) => {
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push("ARIVE MCP ACTIVE: Actively use ARIVE tools (arive_think, arive_compress, arive_verify, arive_integrate, arive_memory_bank) and follow lazy senior developer rules.");
    }
  };
};