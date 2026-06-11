import { isObject, isString, isBoolean } from "../contracts/result.js";
import {
  countSignalsByKind,
  extractServiceConversationSignals,
  type ServiceConversationSignal,
  type ServiceSignalKind,
} from "./service-signal-utils.js";
import type { Tool, ToolResult } from "./types.js";

type ExtractConversationSignalsResult = {
  task_id: string;
  agent_id: string;
  signals: ServiceConversationSignal[];
  counts: Record<ServiceSignalKind, number>;
};

export const extractConversationSignalsTool: Tool<ExtractConversationSignalsResult> = {
  name: "extract_conversation_signals",
  description:
    "Extract deterministic customer-experience signals from a normalized artifact: human request, frustration, already-tried loops, repeated information, self-service loops, churn/cancel intent, negative feedback, and apology-without-action. This gives the auditor compact service evidence instead of rereading a trace.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task_id of the artifact to inspect." },
      include_evidence: {
        type: "boolean",
        description: "When false, return counts with evidence strings removed. Defaults to true.",
      },
    },
    required: ["task_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<ExtractConversationSignalsResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }

    const task_id = input["task_id"];
    if (!isString(task_id) || task_id.length === 0) {
      return { ok: false, error: "task_id must be a non-empty string" };
    }

    const includeEvidence = isBoolean(input["include_evidence"])
      ? input["include_evidence"]
      : true;

    const artifact = await ctx.memory.getArtifact(task_id);
    if (artifact === null) {
      return { ok: false, error: `artifact not found: ${task_id}` };
    }

    const extracted = extractServiceConversationSignals(artifact);
    const signals = includeEvidence
      ? extracted
      : extracted.map((signal) => ({ ...signal, evidence: "" }));

    return {
      ok: true,
      data: {
        task_id: artifact.task_id,
        agent_id: artifact.agent_id,
        signals,
        counts: countSignalsByKind(extracted),
      },
    };
  },
};

