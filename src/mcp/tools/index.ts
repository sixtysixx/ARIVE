import { ToolDef } from "./types.js";
import { toolDef as arive_compress } from "./arive_compress.js";
import { toolDef as arive_decompress } from "./arive_decompress.js";
import { toolDef as arive_think } from "./arive_think.js";
import { toolDef as arive_integrate } from "./arive_integrate.js";
import { toolDef as arive_workspace_list } from "./arive_workspace_list.js";
import { toolDef as arive_verify } from "./arive_verify.js";
import { toolDef as arive_explain } from "./arive_explain.js";
import { toolDef as arive_codetree } from "./arive_codetree.js";
import { toolDef as arive_memory_bank } from "./arive_memory_bank.js";
import { toolDef as arive_install } from "./arive_install.js";
import { toolDef as arive_uninstall } from "./arive_uninstall.js";

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  "arive_compress": arive_compress,
  "arive_decompress": arive_decompress,
  "arive_think": arive_think,
  "arive_integrate": arive_integrate,
  "arive_workspace_list": arive_workspace_list,
  "arive_verify": arive_verify,
  "arive_explain": arive_explain,
  "arive_codetree": arive_codetree,
  "arive_memory_bank": arive_memory_bank,
  "arive_install": arive_install,
  "arive_uninstall": arive_uninstall,
};
