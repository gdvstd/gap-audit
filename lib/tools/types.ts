import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";

export type ToolContext = { memory: AuditMemoryAdapter };
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type Tool<O> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(input: unknown, ctx: ToolContext): Promise<ToolResult<O>>;
};

export type ToolSchema = { name: string; description: string; inputSchema: JsonSchema };
