import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type JsonObject = Record<string, unknown>;

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  handler: (args: JsonObject) => Promise<CallToolResult> | CallToolResult;
}

export function textResult(value: unknown): CallToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function errorResult(
  message: string,
  extra?: JsonObject,
): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, ...(extra ?? {}) }, null, 2),
      },
    ],
  };
}

export function isTextBlock(
  block: unknown,
): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

/** Runs `fn`, rejecting if it does not settle within `ms`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : {};
}

export function requireString(
  args: JsonObject,
  key: string,
  tool: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `'${key}' is required for ${tool} and must be a non-empty string`,
    );
  }
  return value;
}

export function optionalString(
  args: JsonObject,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function optionalNumber(
  args: JsonObject,
  key: string,
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function optionalBoolean(
  args: JsonObject,
  key: string,
): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}
