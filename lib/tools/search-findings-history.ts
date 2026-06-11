import type { AuditFinding } from "../contracts/audit-finding.js";
import { isObject, isString, isNumber } from "../contracts/result.js";
import type { Tool, ToolResult } from "./types.js";

type SearchFindingsHistoryResult = { findings: AuditFinding[] };

export const searchFindingsHistoryTool: Tool<SearchFindingsHistoryResult> = {
  name: "search_findings_history",
  description:
    "Search prior AuditFindings for an agent, optionally filtered by lens, failure_mode, and task_type. Results are sorted by created_at DESC, then finding_id ASC for determinism. Useful for recurrence reasoning in Guardrail Friction and Latent Risk lenses.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Filter findings to this agent." },
      lens: { type: "string", description: "Optional: filter by lens id." },
      failure_mode: { type: "string", description: "Optional: filter by failure_mode." },
      task_type: { type: "string", description: "Optional: filter by task_type." },
      limit: { type: "number", description: "Optional: maximum number of results to return (positive integer)." },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<SearchFindingsHistoryResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const agent_id = input["agent_id"];
    if (!isString(agent_id) || agent_id.length === 0) {
      return { ok: false, error: "agent_id must be a non-empty string" };
    }

    const lens = input["lens"];
    const failure_mode = input["failure_mode"];
    const task_type = input["task_type"];
    const limit = input["limit"];

    let findings = await ctx.memory.listFindings({ agent_id });

    if (isString(lens) && lens.length > 0) {
      findings = findings.filter((f) => f.lens === lens);
    }
    if (isString(failure_mode) && failure_mode.length > 0) {
      findings = findings.filter((f) => f.failure_mode === failure_mode);
    }
    if (isString(task_type) && task_type.length > 0) {
      findings = findings.filter((f) => f.task_type === task_type);
    }

    findings.sort((a, b) => {
      const dateCompare = b.created_at.localeCompare(a.created_at);
      if (dateCompare !== 0) return dateCompare;
      return a.finding_id.localeCompare(b.finding_id);
    });

    if (isNumber(limit) && limit > 0) {
      findings = findings.slice(0, limit);
    }

    return { ok: true, data: { findings } };
  },
};
