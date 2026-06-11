/**
 * Tool registry — composes a subset of tools by name,
 * exposes Gemini functionDeclarations, and dispatches calls.
 */
import type { SimTool, FunctionDeclaration, DispatchArgs, ToolResult } from "./types.js";
import { CS_TOOLS } from "./cs-tools.js";
import { RECRUITING_TOOLS } from "./recruiting-tools.js";
import { DEVOPS_TOOLS } from "./devops-tools.js";
import { AP_TOOLS } from "./ap-tools.js";
import { IT_TOOLS } from "./it-tools.js";
import { SALES_TOOLS } from "./sales-tools.js";
import { submitResult } from "./submit-tool.js";

const ALL_TOOLS: SimTool[] = [
  ...CS_TOOLS,
  ...RECRUITING_TOOLS,
  ...DEVOPS_TOOLS,
  ...AP_TOOLS,
  ...IT_TOOLS,
  ...SALES_TOOLS,
  submitResult,
];

export type ToolRegistry = {
  functionDeclarations: FunctionDeclaration[];
  dispatch(args: DispatchArgs): ToolResult;
};

/**
 * Create a registry scoped to the given tool names.
 * If toolNames is empty, all tools are included.
 */
export function createToolRegistry(toolNames: string[]): ToolRegistry {
  const selected =
    toolNames.length === 0
      ? ALL_TOOLS
      : ALL_TOOLS.filter((t) => toolNames.includes(t.name));

  const toolMap = new Map<string, SimTool>(selected.map((t) => [t.name, t]));

  const functionDeclarations: FunctionDeclaration[] = selected.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parametersJsonSchema,
  }));

  function dispatch({ name, args }: DispatchArgs): ToolResult {
    const tool = toolMap.get(name);
    if (tool === undefined) {
      return { status: "error", output: `Unknown tool: ${name}` };
    }
    return tool.run(args);
  }

  return { functionDeclarations, dispatch };
}
