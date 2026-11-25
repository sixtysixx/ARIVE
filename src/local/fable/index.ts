/**
 * The fable ruleset is in-process only: no downstream server exists for it, so
 * the tools are compiled from the vendored markdown under ./content.
 */
export { createFableTools } from "./tools.js";
