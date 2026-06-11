import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import { aggregateServiceOutcomesTool } from "../aggregate-service-outcomes.js";
import type { ToolContext } from "../types.js";

function makeArtifact(
  task_id: string,
  overrides: Partial<AuditArtifact> = {}
): AuditArtifact {
  return {
    task_id,
    agent_id: "agent-support",
    timestamp: "2026-05-01T00:00:00Z",
    task_type: "cancellation",
    user_input_summary: "I already tried the self-service flow and want a human.",
    declared_goal: "Resolve cancellation request.",
    final_output_summary: "You can cancel from Settings > Billing.",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [
      {
        type: "customer_reply",
        visibility: "external",
        reversible: false,
        target: "customer",
      },
    ],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

function makeFinding(
  finding_id: string,
  overrides: Partial<AuditFinding> = {}
): AuditFinding {
  return {
    finding_id,
    task_id: "task-1",
    agent_id: "agent-support",
    lens: "resolved-but-not-served",
    failure_mode: "Self-service loop after human request",
    severity: "high",
    confidence: 0.88,
    evidence: ["resolved but user requested human after prior attempts"],
    evidence_keywords: ["resolved", "human", "self-service"],
    recommended_action: "Escalate repeated-contact cancellation requests",
    human_review_required: true,
    converted_to_eval: false,
    task_type: "cancellation",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("aggregateServiceOutcomesTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name and schema", () => {
    expect(aggregateServiceOutcomesTool.name).toBe("aggregate_service_outcomes");
    expect(aggregateServiceOutcomesTool.inputSchema.required).toContain("agent_id");
  });

  it("returns ok:false when agent_id is missing", async () => {
    const result = await aggregateServiceOutcomesTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns empty aggregate when the agent has no artifacts", async () => {
    const result = await aggregateServiceOutcomesTool.run({ agent_id: "agent-support" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.artifact_count).toBe(0);
    expect(result.data.status_counts).toEqual({});
    expect(result.data.risk_counts.guardrail_events).toBe(0);
  });

  it("aggregates resolved status, service signals, risks, and finding history", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", {
        tool_facts: [
          {
            tool: "policy_lookup",
            status: "success",
            fact: "Human escalation is available after repeated cancellation contacts.",
          },
        ],
      }),
      makeArtifact("task-2", {
        task_type: "refund",
        user_input_summary: "Refund request.",
        final_output_summary: "Refund processed.",
        agent_status: "needs_review",
        actions_taken: [],
        verification_artifacts: [
          { type: "refund_confirmation", status: "failed", summary: "refund API failed" },
        ],
      }),
      makeArtifact("task-3", {
        task_type: "incident",
        user_input_summary: "Please resolve outage.",
        final_output_summary: "Incident resolved.",
        tool_facts: [
          { tool: "query_metrics", status: "success", fact: "error_rate still above threshold" },
        ],
        verification_artifacts: [
          { type: "metric_recovery", status: "failed", summary: "error_rate still above threshold" },
        ],
        actions_taken: [],
      }),
    ]);
    await ctx.memory.saveFindings([
      makeFinding("f-1"),
      makeFinding("f-2", {
        lens: "operational-drift",
        failure_mode: "Repeat contact drift",
        severity: "critical",
      }),
    ]);

    const result = await aggregateServiceOutcomesTool.run({ agent_id: "agent-support" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.artifact_count).toBe(3);
    expect(result.data.status_counts.resolved).toBe(2);
    expect(result.data.status_counts.needs_review).toBe(1);
    expect(result.data.task_type_counts.cancellation).toBe(1);
    expect(result.data.service_signal_counts.human_request).toBeGreaterThan(0);
    expect(result.data.service_signal_counts.already_tried).toBeGreaterThan(0);
    expect(result.data.service_signal_counts.self_service_loop).toBeGreaterThan(0);
    expect(result.data.risk_counts.external_irreversible_actions).toBe(1);
    expect(result.data.risk_counts.resolved_with_failed_verification).toBe(1);
    expect(result.data.finding_counts.by_lens["resolved-but-not-served"]).toBe(1);
    expect(result.data.finding_counts.by_lens["operational-drift"]).toBe(1);
    expect(result.data.finding_counts.high_or_critical).toBe(2);
    expect(result.data.representative_task_ids.resolved_with_failed_verification).toContain("task-3");
  });

  it("filters artifacts and findings by task_type", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-cancel", { task_type: "cancellation" }),
      makeArtifact("task-refund", { task_type: "refund" }),
    ]);
    await ctx.memory.saveFindings([
      makeFinding("f-cancel", { task_id: "task-cancel", task_type: "cancellation" }),
      makeFinding("f-refund", { task_id: "task-refund", task_type: "refund" }),
    ]);

    const result = await aggregateServiceOutcomesTool.run({
      agent_id: "agent-support",
      task_type: "refund",
    }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.task_type).toBe("refund");
    expect(result.data.artifact_count).toBe(1);
    expect(result.data.task_type_counts.refund).toBe(1);
    expect(result.data.finding_counts.high_or_critical).toBe(1);
  });

  it("limits representative task ids", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1"),
      makeArtifact("task-2"),
      makeArtifact("task-3"),
    ]);

    const result = await aggregateServiceOutcomesTool.run({
      agent_id: "agent-support",
      example_limit: 2,
    }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.representative_task_ids.external_irreversible_actions).toHaveLength(2);
  });
});

