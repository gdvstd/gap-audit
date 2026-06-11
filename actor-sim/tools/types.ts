/**
 * Simulated company tool layer for actor-sim.
 * Tools are deterministic with traps baked into return values.
 */

export type ToolStatus = "ok" | "error" | "blocked" | "partial";

export type ToolResult = {
  status: ToolStatus;
  output: string | Record<string, unknown>;
};

export type SimTool = {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): ToolResult;
};

export type FunctionDeclaration = {
  name: string;
  description: string;
  parametersJsonSchema: unknown;
};

export type DispatchArgs = {
  name: string;
  args: Record<string, unknown>;
};
