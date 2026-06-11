import type {
  ActionTaken,
  AuditArtifact,
  GuardrailEvent,
  MemoryWrite,
  SourceRef,
  SupportContext,
  ToolFact,
  VerificationArtifact,
} from "../contracts/audit-artifact.js";
import type { AgentStatus, RetentionRisk, ToolStatus, VerificationStatus, Visibility } from "../contracts/enums.js";
import { AGENT_STATUSES, RETENTION_RISKS, VERIFICATION_STATUSES, VISIBILITY_VALUES } from "../contracts/enums.js";
import { validateAuditArtifact } from "../contracts/audit-artifact.js";
import { isBoolean, isNumber, isString } from "../contracts/result.js";
import type { RawTraceArtifact, RawSpan } from "./raw-trace.js";

export type RedactionSummary = {
  entity_types: string[];
  redacted_field_count: number;
};

export type NormalizationResult =
  | { ok: true; value: AuditArtifact; redactions: RedactionSummary }
  | { ok: false; errors: string[] };

const MAX_FACT_LENGTH = 280;

function truncate(text: string): string {
  return text.length > MAX_FACT_LENGTH ? text.slice(0, MAX_FACT_LENGTH) : text;
}

function stringValue(value: string | undefined): string {
  return value ?? "";
}

function mapSpanStatusToToolStatus(status: RawSpan["status"]): ToolStatus {
  if (status === "ok") return "success";
  if (status === "error") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "partial") return "partial";
  return "unknown";
}

function mapAgentStatus(raw: string | undefined): AgentStatus {
  if (raw === undefined) return "unknown";
  const lower = raw.toLowerCase();
  if ((AGENT_STATUSES as readonly string[]).includes(lower)) {
    return lower as AgentStatus;
  }
  return "unknown";
}

function mapVisibility(raw: unknown): Visibility {
  if (isString(raw) && (VISIBILITY_VALUES as readonly string[]).includes(raw)) {
    return raw as Visibility;
  }
  return "unknown";
}

function mapVerificationStatus(raw: unknown): VerificationStatus {
  if (isString(raw) && (VERIFICATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as VerificationStatus;
  }
  return "unknown";
}

function mapRetentionRisk(raw: unknown): RetentionRisk | undefined {
  if (isString(raw) && (RETENTION_RISKS as readonly string[]).includes(raw)) {
    return raw as RetentionRisk;
  }
  return undefined;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (isString(value) && value.trim().length > 0) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function addSignals(out: Set<string>, value: unknown): void {
  for (const item of stringArrayFromUnknown(value)) {
    out.add(item);
  }
}

function extractToolFacts(spans: RawSpan[]): ToolFact[] {
  return spans
    .filter((s) => s.kind === "tool")
    .map((s) => {
      const rawOutput = s.output ?? "";
      const fact = truncate(s.name + (rawOutput.length > 0 ? ": " + rawOutput : ""));
      return {
        tool: s.name,
        status: mapSpanStatusToToolStatus(s.status),
        fact,
      };
    });
}

function extractActionsTaken(spans: RawSpan[]): ActionTaken[] {
  return spans
    .filter((s) => {
      const attrs = s.attributes ?? {};
      return isString(attrs["action_type"]) || (s.kind === "tool" && isString(attrs["visibility"]));
    })
    .map((s) => {
      const attrs = s.attributes ?? {};
      const type = isString(attrs["action_type"]) ? attrs["action_type"] : s.name;
      const visibility = mapVisibility(attrs["visibility"]);
      const reversible = attrs["reversible"] === false ? false : true;
      const action: ActionTaken = { type, visibility, reversible };
      if (isString(attrs["target"])) {
        action.target = attrs["target"];
      }
      return action;
    });
}

function extractMemoryWrites(spans: RawSpan[]): MemoryWrite[] {
  return spans
    .filter((s) => s.kind === "memory")
    .map((s) => {
      const attrs = s.attributes ?? {};
      const store = isString(attrs["store"]) ? attrs["store"] : s.name;
      const content_summary = truncate(s.output ?? "");
      const sensitive_entity_types = stringArrayFromUnknown(attrs["sensitive_entity_types"]);
      const mw: MemoryWrite = { store, content_summary, sensitive_entity_types };
      const retentionRisk = mapRetentionRisk(attrs["retention_risk"]);
      if (retentionRisk !== undefined) {
        mw.retention_risk = retentionRisk;
      }
      return mw;
    });
}

function extractGuardrailEvents(spans: RawSpan[]): GuardrailEvent[] {
  return spans
    .filter((s) => s.kind === "guardrail")
    .map((s) => {
      const attrs = s.attributes ?? {};
      const reason = isString(attrs["reason"]) ? attrs["reason"] : (s.output ?? "");
      const ge: GuardrailEvent = { type: s.name, reason };
      if (isNumber(attrs["count"])) ge.count = attrs["count"];
      if (isString(attrs["time_window"])) ge.time_window = attrs["time_window"];
      return ge;
    });
}

function extractVerificationArtifacts(spans: RawSpan[]): VerificationArtifact[] {
  return spans
    .filter((s) => {
      const attrs = s.attributes ?? {};
      return isString(attrs["verification_type"]);
    })
    .map((s) => {
      const attrs = s.attributes ?? {};
      const type = attrs["verification_type"] as string;
      const status = mapVerificationStatus(attrs["verification_status"]);
      const summary = truncate(s.output ?? "");
      return { type, status, summary };
    });
}

function collectServiceSignals(raw: RawTraceArtifact, field: "conversation_signals" | "operational_signals" | "business_signals"): string[] {
  const out = new Set<string>();
  addSignals(out, raw[field]);

  for (const span of raw.spans) {
    const attrs = span.attributes ?? {};
    addSignals(out, attrs[field]);
    addSignals(out, attrs[field.slice(0, -1)]);
  }

  return [...out].sort();
}

function supportContextFromRaw(raw: RawTraceArtifact): SupportContext | undefined {
  const input = raw.support_context;
  if (input === undefined) return undefined;

  const context: SupportContext = {};
  const stringFields = ["case_id", "issue_category", "channel", "customer_segment"] as const;
  const numberFields = ["prior_contact_count", "follow_up_minutes", "csat"] as const;
  const booleanFields = [
    "thumbs_down",
    "escalation_requested",
    "escalation_offered",
    "escalation_after_resolution",
    "repeat_contact",
  ] as const;

  for (const field of stringFields) {
    if (isString(input[field])) {
      context[field] = input[field];
    }
  }
  for (const field of numberFields) {
    if (isNumber(input[field])) {
      context[field] = input[field];
    }
  }
  for (const field of booleanFields) {
    if (isBoolean(input[field])) {
      context[field] = input[field];
    }
  }

  return context;
}

function sensitiveEntityTypesFromSpans(spans: RawSpan[]): string[] {
  const out = new Set<string>();
  for (const span of spans) {
    const attrs = span.attributes ?? {};
    addSignals(out, attrs["sensitive_entity_types"]);
  }
  return [...out].sort();
}

export function normalizeRawTrace(raw: RawTraceArtifact): NormalizationResult {
  if (raw.agent_confidence !== undefined && (raw.agent_confidence < 0 || raw.agent_confidence > 1)) {
    return { ok: false, errors: [`agent_confidence must be in [0, 1]; got ${raw.agent_confidence}`] };
  }

  const customerInputSummary = stringValue(raw.customer_input ?? raw.user_input);
  const companyTask = stringValue(raw.company_task ?? raw.declared_goal);
  const customerGoal = stringValue(raw.customer_goal ?? raw.customer_input ?? raw.user_input);
  const finalResponseSummary = stringValue(raw.final_response ?? raw.final_output);
  const sourceRef: SourceRef = raw.source !== undefined
    ? {
        source: raw.source.system,
        ...(raw.source.external_id !== undefined && { external_id: raw.source.external_id }),
        ...(raw.source.label !== undefined && { label: raw.source.label }),
      }
    : { source: "other" };

  const candidate: Record<string, unknown> = {
    task_id: raw.trace_id,
    agent_id: raw.agent_id,
    timestamp: raw.started_at,
    customer_input_summary: customerInputSummary,
    company_task: companyTask,
    customer_goal: customerGoal,
    final_response_summary: finalResponseSummary,
    user_input_summary: customerInputSummary,
    declared_goal: companyTask,
    final_output_summary: finalResponseSummary,
    conversation_signals: collectServiceSignals(raw, "conversation_signals"),
    operational_signals: collectServiceSignals(raw, "operational_signals"),
    business_signals: collectServiceSignals(raw, "business_signals"),
    tool_facts: extractToolFacts(raw.spans),
    agent_status: mapAgentStatus(raw.agent_status),
    actions_taken: extractActionsTaken(raw.spans),
    sensitive_entity_types: sensitiveEntityTypesFromSpans(raw.spans),
    memory_writes: extractMemoryWrites(raw.spans),
    guardrail_events: extractGuardrailEvents(raw.spans),
    verification_artifacts: extractVerificationArtifacts(raw.spans),
    source_refs: [sourceRef],
  };

  const supportContext = supportContextFromRaw(raw);
  if (supportContext !== undefined) candidate["support_context"] = supportContext;
  if (raw.task_type !== undefined) candidate["task_type"] = raw.task_type;
  if (raw.agent_confidence !== undefined) candidate["agent_confidence"] = raw.agent_confidence;

  const validationResult = validateAuditArtifact(candidate);
  if (!validationResult.ok) {
    return { ok: false, errors: validationResult.errors };
  }

  return {
    ok: true,
    value: validationResult.value,
    redactions: {
      entity_types: validationResult.value.sensitive_entity_types,
      redacted_field_count: 0,
    },
  };
}
