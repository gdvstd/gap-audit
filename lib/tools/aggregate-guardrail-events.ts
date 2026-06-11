import { isObject, isString } from "../contracts/result.js";
import type { Tool, ToolResult } from "./types.js";

type GuardrailAggregateGroup = {
  type: string;
  reason: string;
  count: number;
  time_window?: string;
};

type AggregateGuardrailEventsResult = {
  groups: GuardrailAggregateGroup[];
  total: number;
};

export const aggregateGuardrailEventsTool: Tool<AggregateGuardrailEventsResult> = {
  name: "aggregate_guardrail_events",
  description:
    "Aggregate guardrail_events across all artifacts for an agent, grouped by (type, reason). Returns sorted groups and a total count. Deterministically computes the '23 blocks/week' signal for Guardrail Friction analysis.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Aggregate events for this agent." },
      type: { type: "string", description: "Optional: filter by guardrail event type." },
      window: { type: "string", description: "Optional: time window label (informational)." },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<AggregateGuardrailEventsResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const agent_id = input["agent_id"];
    if (!isString(agent_id) || agent_id.length === 0) {
      return { ok: false, error: "agent_id must be a non-empty string" };
    }

    const typeFilter = input["type"];

    const artifacts = await ctx.memory.listArtifacts({ agent_id });

    // Map from "type\0reason" → { count, time_window }
    const groupMap = new Map<string, { type: string; reason: string; count: number; time_window?: string }>();

    for (const artifact of artifacts) {
      for (const event of artifact.guardrail_events) {
        if (isString(typeFilter) && typeFilter.length > 0 && event.type !== typeFilter) {
          continue;
        }
        const key = `${event.type}\0${event.reason}`;
        const existing = groupMap.get(key);
        const eventCount = typeof event.count === "number" ? event.count : 1;

        if (existing === undefined) {
          const group: GuardrailAggregateGroup = {
            type: event.type,
            reason: event.reason,
            count: eventCount,
          };
          // Only set time_window if present and non-empty — respect exactOptionalPropertyTypes
          if (isString(event.time_window) && event.time_window.length > 0) {
            group.time_window = event.time_window;
          }
          groupMap.set(key, group);
        } else {
          existing.count += eventCount;
          // Keep first non-empty time_window seen
          if (
            !("time_window" in existing) &&
            isString(event.time_window) &&
            event.time_window.length > 0
          ) {
            existing.time_window = event.time_window;
          }
        }
      }
    }

    const groups = Array.from(groupMap.values());

    groups.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const typeCompare = a.type.localeCompare(b.type);
      if (typeCompare !== 0) return typeCompare;
      return a.reason.localeCompare(b.reason);
    });

    const total = groups.reduce((sum, g) => sum + g.count, 0);

    return { ok: true, data: { groups, total } };
  },
};
