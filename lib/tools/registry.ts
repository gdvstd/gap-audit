import { getArtifactTool } from "./get-artifact.js";
import { getAgentProfileTool } from "./get-agent-profile.js";
import { searchFindingsHistoryTool } from "./search-findings-history.js";
import { findSimilarFindingsTool } from "./find-similar-findings.js";
import { aggregateGuardrailEventsTool } from "./aggregate-guardrail-events.js";
import { aggregateServiceOutcomesTool } from "./aggregate-service-outcomes.js";
import { extractConversationSignalsTool } from "./extract-conversation-signals.js";
import { inspectHandoffQualityTool } from "./inspect-handoff-quality.js";
import type { Tool, ToolContext, ToolResult, ToolSchema } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: Tool<any>[] = [
  getArtifactTool,
  getAgentProfileTool,
  searchFindingsHistoryTool,
  findSimilarFindingsTool,
  aggregateGuardrailEventsTool,
  extractConversationSignalsTool,
  inspectHandoffQualityTool,
  aggregateServiceOutcomesTool,
];

export type ToolRegistry = {
  schemas: ToolSchema[];
  list(): ToolSchema[];
  dispatch(call: { tool: string; input: unknown }): Promise<ToolResult<unknown>>;
};

export function createToolRegistry(ctx: ToolContext): ToolRegistry {
  const toolMap = new Map<string, Tool<unknown>>(
    ALL_TOOLS.map((t) => [t.name, t as Tool<unknown>])
  );

  const schemas: ToolSchema[] = ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  return {
    schemas,

    list(): ToolSchema[] {
      return schemas;
    },

    async dispatch(call: { tool: string; input: unknown }): Promise<ToolResult<unknown>> {
      const tool = toolMap.get(call.tool);
      if (tool === undefined) {
        return { ok: false, error: `unknown tool: ${call.tool}` };
      }
      return tool.run(call.input, ctx);
    },
  };
}
