import type { AuditArtifact } from "../contracts/audit-artifact.js";
import { isObject, isString } from "../contracts/result.js";
import { extractServiceConversationSignals } from "./service-signal-utils.js";
import type { Tool, ToolResult } from "./types.js";

type HandoffQualityResult = {
  task_id: string;
  agent_id: string;
  handoff_detected: boolean;
  handoff_actions: string[];
  context_preserved: boolean;
  repeated_info_risk: boolean;
  missing_context_risk: boolean;
  evidence: string[];
};

const HANDOFF_RE = /\b(handoff|hand off|transfer(?:red)?|escalat(?:e|ed|ing|ion)|routed|assigned|human|representative|on-call|on call|support agent|manager)\b/i;
const CONTEXT_RE = /\b(summary|context|transcript|case id|ticket|order id|account id|prior|previous|already provided|attached|preserved|included details|handoff note)\b/i;
const MISSING_CONTEXT_RE = /\b(without|no|missing|omitted|absent)\b.{0,40}\b(summary|context|transcript|handoff note|details)\b/i;
const INFO_REQUEST_RE = /\b(please provide|can you provide|send us|tell me|what is your|share your|confirm your|provide the same)\b/i;

function compactEvidence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? compact.slice(0, 180) : compact;
}

function allArtifactText(artifact: AuditArtifact): string[] {
  const values: string[] = [
    artifact.customer_input_summary ?? artifact.user_input_summary,
    artifact.customer_goal ?? "",
    artifact.company_task ?? artifact.declared_goal,
    artifact.final_response_summary ?? artifact.final_output_summary,
    ...artifact.tool_facts.map((f) => f.fact),
    ...artifact.actions_taken.map((a) => [a.type, a.target, a.visibility].filter(Boolean).join(" ")),
    ...artifact.memory_writes.map((w) => w.content_summary),
    ...artifact.guardrail_events.map((e) => e.reason),
    ...(artifact.verification_artifacts ?? []).map((v) => v.summary),
  ];

  for (const field of ["conversation_signals", "operational_signals", "business_signals"] as const) {
    const value = artifact[field];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") values.push(item);
      }
    }
  }

  return values.filter((value) => value.trim().length > 0);
}

function findHandoffActions(artifact: AuditArtifact): string[] {
  const actions = artifact.actions_taken
    .filter((action) => HANDOFF_RE.test(`${action.type} ${action.target ?? ""}`))
    .map((action) => [action.type, action.target].filter(Boolean).join(":"));

  const toolActions = artifact.tool_facts
    .filter((fact) => HANDOFF_RE.test(`${fact.tool} ${fact.fact}`))
    .map((fact) => fact.tool);

  return Array.from(new Set([...actions, ...toolActions])).sort();
}

export const inspectHandoffQualityTool: Tool<HandoffQualityResult> = {
  name: "inspect_handoff_quality",
  description:
    "Inspect whether a handoff/escalation preserved customer context or created repeated-information burden. Returns deterministic handoff, context-preservation, and missing-context risk signals for Customer Effort Inflation.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task_id of the artifact to inspect." },
    },
    required: ["task_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<HandoffQualityResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const task_id = input["task_id"];
    if (!isString(task_id) || task_id.length === 0) {
      return { ok: false, error: "task_id must be a non-empty string" };
    }

    const artifact = await ctx.memory.getArtifact(task_id);
    if (artifact === null) {
      return { ok: false, error: `artifact not found: ${task_id}` };
    }

    const texts = allArtifactText(artifact);
    const combined = texts.join("\n");
    const handoffActions = findHandoffActions(artifact);
    const handoffDetected = handoffActions.length > 0 || HANDOFF_RE.test(combined);
    const contextEvidence = texts.find((text) => CONTEXT_RE.test(text) && !MISSING_CONTEXT_RE.test(text));
    const contextPreserved = contextEvidence !== undefined;
    const signals = extractServiceConversationSignals(artifact);
    const repeatedInfoRisk =
      signals.some((signal) => signal.kind === "repeat_information" || signal.kind === "already_tried") ||
      INFO_REQUEST_RE.test(combined);
    const missingContextRisk = handoffDetected && (!contextPreserved || repeatedInfoRisk);

    const evidence: string[] = [];
    if (handoffDetected) {
      evidence.push(`handoff detected: ${handoffActions.length > 0 ? handoffActions.join(", ") : "text signal"}`);
    }
    if (contextPreserved) {
      evidence.push(`context preservation signal: ${compactEvidence(contextEvidence)}`);
    }
    if (repeatedInfoRisk) {
      const signal = signals.find((s) => s.kind === "repeat_information" || s.kind === "already_tried");
      if (signal !== undefined) {
        evidence.push(`repeated-information signal: ${signal.evidence}`);
      } else {
        const match = texts.find((text) => INFO_REQUEST_RE.test(text));
        if (match !== undefined) evidence.push(`information request signal: ${compactEvidence(match)}`);
      }
    }
    if (missingContextRisk) {
      evidence.push("handoff may create customer burden because context preservation is missing or repeated-information risk is present");
    }

    return {
      ok: true,
      data: {
        task_id: artifact.task_id,
        agent_id: artifact.agent_id,
        handoff_detected: handoffDetected,
        handoff_actions: handoffActions,
        context_preserved: contextPreserved,
        repeated_info_risk: repeatedInfoRisk,
        missing_context_risk: missingContextRisk,
        evidence,
      },
    };
  },
};
