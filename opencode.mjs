/**
 * ARIVE plugin for OpenCode and KiloCode.
 *
 * Add to your opencode.json (project or global):
 *   { "plugin": ["github:sixtysixx/ARIVE"] }
 *
 * This registers the ARIVE MCP server so all arive_* tools are
 * available immediately — no separate mcp config entry required.
 */
export default function arivePlugin(ctx) {
  ctx.mcp({
    name: "arive",
    type: "local",
    command: ["bun", "x", "--silent", "github:sixtysixx/ARIVE"],
    enabled: true,
  });
}
