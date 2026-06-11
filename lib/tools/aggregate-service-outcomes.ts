import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { Severity } from "../contracts/enums.js";
import { isObject, isString, isNumber } from "../contracts/result.js";
import {
  countSignalsByKind,
  extractServiceConversationSignals,
  type ServiceSignalKind,
} from "./service-signal-utils.js";
import type { Tool, ToolResult } from "./types.js";

type RiskCounts = {
  resolved_with_failed_tool: number;
  resolved_with_failed_verification: number;
  external_irreversible_actions: number;
  sensitive_retention: number;
  guardrail_events: number;
  handoff_or_escalation: number;
};

type FindingCounts = {
  by_lens: Record<string, number>;
  by_failure_mode: Record<string, number>;
  high_or_critical: number;
  human_review_required: number;
};

type AggregateServiceOutcomesResult = {
  agent_id: string;
  task_type?: string;
  artifact_count: number;
  status_counts: Record<string, number>;
  task_type_counts: Record<string, number>;
  service_signal_counts: Record<ServiceSignalKind, number>;
  risk_counts: RiskCounts;
  finding_counts: FindingCounts;
  representative_task_ids: Record<string, string[]>;
};

const HIGH_SEVERITIES = new Set<Severity>(["high", "critical"]);
const HANDOFF_RE = /\b(handoff|hand off|transfer(?:red)?|escalat(?:e|ed|ing|ion)|routed|assigned|human|representative|on-call|on call|manager)\b/i;

function inc(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

function addExample(
  examples: Record<string, string[]>,
  key: string,
  taskId: string,
  limit: number
): void {
  const list = examples[key] ?? [];
  if (list.length < limit && !list.includes(taskId)) {
    list.push(taskId);
  }
  examples[key] = list;
}

function hasFailedTool(artifact: AuditArtifact): boolean {
  return artifact.tool_facts.some((fact) => fact.status !== "success");
}

function hasFailedVerification(artifact: AuditArtifact): boolean {
  return (artifact.verification_artifacts ?? []).some((item) =>
    item.status === "failed" || item.status === "missing"
  );
}

function hasExternalIrreversibleAction(artifact: AuditArtifact): boolean {
  return artifact.actions_taken.some((action) =>
    (action.visibility === "external" || action.visibility === "public") && !action.reversible
  );
}

function hasSensitiveRetention(artifact: AuditArtifact): boolean {
  if ((artifact.sensitive_entity_types ?? []).length > 0) return true;
  return artifact.memory_writes.some((write) =>
    (write.sensitive_entity_types ?? []).length > 0 ||
    write.retention_risk === "high" ||
    write.retention_risk === "critical"
  );
}

function guardrailCount(artifact: AuditArtifact): number {
  return artifact.guardrail_events.reduce((sum, event) => sum + (event.count ?? 1), 0);
}

function hasHandoffOrEscalation(artifact: AuditArtifact): boolean {
  const actionText = artifact.actions_taken
    .map((action) => `${action.type} ${action.target ?? ""}`)
    .join("\n");
  const factText = artifact.tool_facts.map((fact) => `${fact.tool} ${fact.fact}`).join("\n");
  return HANDOFF_RE.test(`${actionText}\n${factText}\n${artifact.final_response_summary ?? artifact.final_output_summary}`);
}

function blankSignalCounts(): Record<ServiceSignalKind, number> {
  return {
    human_request: 0,
    frustration: 0,
    already_tried: 0,
    repeat_information: 0,
    self_service_loop: 0,
    churn_or_cancellation_intent: 0,
    negative_feedback: 0,
    apology_without_action: 0,
  };
}

function addSignalCounts(
  total: Record<ServiceSignalKind, number>,
  next: Record<ServiceSignalKind, number>
): void {
  for (const key of Object.keys(total) as ServiceSignalKind[]) {
    total[key] += next[key];
  }
}

function filterByTaskType<T extends { task_type?: string }>(items: T[], taskType: string | undefined): T[] {
  if (taskType === undefined) return items;
  return items.filter((item) => item.task_type === taskType);
}

export const aggregateServiceOutcomesTool: Tool<AggregateServiceOutcomesResult> = {
  name: "aggregate_service_outcomes",
  description:
    "Aggregate service audit artifacts and finding history into outcome counts for an agent: resolved-with-failed-evidence, failed verification, external irreversible actions, customer effort signals, handoff/escalation signals, trust-sensitive retention, and finding recurrence. This is the deterministic evidence layer for Operational Drift and avoids rereading many traces.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Aggregate service outcomes for this agent." },
      task_type: { type: "string", description: "Optional task_type filter." },
      example_limit: {
        type: "number",
        description: "Maximum representative task_ids to retain per risk bucket. Defaults to 5.",
      },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<AggregateServiceOutcomesResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }

    const agent_id = input["agent_id"];
    if (!isString(agent_id) || agent_id.length === 0) {
      return { ok: false, error: "agent_id must be a non-empty string" };
    }

    const taskType = isString(input["task_type"]) && input["task_type"].length > 0
      ? input["task_type"]
      : undefined;
    const exampleLimit = isNumber(input["example_limit"]) && input["example_limit"] > 0
      ? Math.floor(input["example_limit"])
      : 5;

    const allArtifacts = await ctx.memory.listArtifacts({ agent_id });
    const artifacts = filterByTaskType(allArtifacts, taskType);
    const allFindings = await ctx.memory.listFindings({ agent_id });
    const findings = filterByTaskType(allFindings, taskType);

    const statusCounts: Record<string, number> = {};
    const taskTypeCounts: Record<string, number> = {};
    const serviceSignalCounts = blankSignalCounts();
    const riskCounts: RiskCounts = {
      resolved_with_failed_tool: 0,
      resolved_with_failed_verification: 0,
      external_irreversible_actions: 0,
      sensitive_retention: 0,
      guardrail_events: 0,
      handoff_or_escalation: 0,
    };
    const findingCounts: FindingCounts = {
      by_lens: {},
      by_failure_mode: {},
      high_or_critical: 0,
      human_review_required: 0,
    };
    const representativeTaskIds: Record<string, string[]> = {};

    for (const artifact of artifacts) {
      inc(statusCounts, artifact.agent_status);
      inc(taskTypeCounts, artifact.task_type ?? "unknown");

      const signalCounts = countSignalsByKind(extractServiceConversationSignals(artifact));
      addSignalCounts(serviceSignalCounts, signalCounts);

      const failedTool = hasFailedTool(artifact);
      const failedVerification = hasFailedVerification(artifact);
      if (artifact.agent_status === "resolved" && failedTool) {
        riskCounts.resolved_with_failed_tool += 1;
        addExample(representativeTaskIds, "resolved_with_failed_tool", artifact.task_id, exampleLimit);
      }
      if (artifact.agent_status === "resolved" && failedVerification) {
        riskCounts.resolved_with_failed_verification += 1;
        addExample(representativeTaskIds, "resolved_with_failed_verification", artifact.task_id, exampleLimit);
      }
      if (hasExternalIrreversibleAction(artifact)) {
        riskCounts.external_irreversible_actions += 1;
        addExample(representativeTaskIds, "external_irreversible_actions", artifact.task_id, exampleLimit);
      }
      if (hasSensitiveRetention(artifact)) {
        riskCounts.sensitive_retention += 1;
        addExample(representativeTaskIds, "sensitive_retention", artifact.task_id, exampleLimit);
      }
      const guardrails = guardrailCount(artifact);
      if (guardrails > 0) {
        riskCounts.guardrail_events += guardrails;
        addExample(representativeTaskIds, "guardrail_events", artifact.task_id, exampleLimit);
      }
      if (hasHandoffOrEscalation(artifact)) {
        riskCounts.handoff_or_escalation += 1;
        addExample(representativeTaskIds, "handoff_or_escalation", artifact.task_id, exampleLimit);
      }

      for (const key of Object.keys(signalCounts) as ServiceSignalKind[]) {
        if (signalCounts[key] > 0) {
          addExample(representativeTaskIds, key, artifact.task_id, exampleLimit);
        }
      }
    }

    for (const finding of findings as AuditFinding[]) {
      inc(findingCounts.by_lens, finding.lens);
      inc(findingCounts.by_failure_mode, finding.failure_mode);
      if (HIGH_SEVERITIES.has(finding.severity)) findingCounts.high_or_critical += 1;
      if (finding.human_review_required) findingCounts.human_review_required += 1;
    }

    const data: AggregateServiceOutcomesResult = {
      agent_id,
      artifact_count: artifacts.length,
      status_counts: statusCounts,
      task_type_counts: taskTypeCounts,
      service_signal_counts: serviceSignalCounts,
      risk_counts: riskCounts,
      finding_counts: findingCounts,
      representative_task_ids: representativeTaskIds,
    };
    if (taskType !== undefined) data.task_type = taskType;

    return { ok: true, data };
  },
};
