import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import { inspectHandoffQualityTool } from "../inspect-handoff-quality.js";
import type { ToolContext } from "../types.js";

function makeArtifact(overrides: Partial<AuditArtifact> = {}): AuditArtifact {
  return {
    task_id: "task-1",
    agent_id: "agent-support",
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "I already told the bot my order ID and issue details.",
    declared_goal: "Escalate to a human if the AI cannot resolve the issue.",
    final_output_summary: "I am transferring you to a human support agent. Please provide your order ID again.",
    tool_facts: [
      {
        tool: "handoff_to_human",
        status: "success",
        fact: "handoff_to_human: routed to Tier 2 queue without context summary",
      },
    ],
    agent_status: "needs_review",
    actions_taken: [
      {
        type: "escalation",
        visibility: "internal",
        reversible: true,
        target: "tier_2_support",
      },
    ],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("inspectHandoffQualityTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name and schema", () => {
    expect(inspectHandoffQualityTool.name).toBe("inspect_handoff_quality");
    expect(inspectHandoffQualityTool.inputSchema.required).toContain("task_id");
  });

  it("returns ok:false for missing task_id", async () => {
    const result = await inspectHandoffQualityTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("detects missing-context handoff burden", async () => {
    await ctx.memory.saveArtifacts([makeArtifact()]);

    const result = await inspectHandoffQualityTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.handoff_detected).toBe(true);
    expect(result.data.repeated_info_risk).toBe(true);
    expect(result.data.missing_context_risk).toBe(true);
    expect(result.data.evidence.join("\n")).toContain("repeated-information signal");
  });

  it("does not mark missing context when context is preserved", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact({
        user_input_summary: "The customer provided the issue details.",
        final_output_summary:
          "I am transferring you to a human support agent with a handoff summary, transcript, and prior order context attached.",
        tool_facts: [
          {
            tool: "handoff_to_human",
            status: "success",
            fact: "handoff_to_human: routed to Tier 2 with transcript and context summary",
          },
        ],
      }),
    ]);

    const result = await inspectHandoffQualityTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.handoff_detected).toBe(true);
    expect(result.data.context_preserved).toBe(true);
    expect(result.data.repeated_info_risk).toBe(false);
    expect(result.data.missing_context_risk).toBe(false);
  });

  it("returns false handoff flags when no handoff is present", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact({
        user_input_summary: "Please check my refund status.",
        declared_goal: "Answer refund status.",
        final_output_summary: "Your refund is pending review.",
        tool_facts: [],
        actions_taken: [],
      }),
    ]);

    const result = await inspectHandoffQualityTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.handoff_detected).toBe(false);
    expect(result.data.missing_context_risk).toBe(false);
  });
});

