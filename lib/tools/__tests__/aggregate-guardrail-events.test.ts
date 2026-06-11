import { describe, it, expect, beforeEach } from "vitest";
import { aggregateGuardrailEventsTool } from "../aggregate-guardrail-events.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { ToolContext } from "../types.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

function makeArtifact(
  task_id: string,
  agent_id = "agent-1",
  guardrail_events: AuditArtifact["guardrail_events"] = []
): AuditArtifact {
  return {
    task_id,
    agent_id,
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "test input",
    declared_goal: "test goal",
    final_output_summary: "test output",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("aggregateGuardrailEventsTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name", () => {
    expect(aggregateGuardrailEventsTool.name).toBe("aggregate_guardrail_events");
  });

  it("has a non-empty description", () => {
    expect(aggregateGuardrailEventsTool.description.length).toBeGreaterThan(0);
  });

  it("has a valid inputSchema with agent_id required", () => {
    expect(aggregateGuardrailEventsTool.inputSchema.type).toBe("object");
    expect(aggregateGuardrailEventsTool.inputSchema.required).toContain("agent_id");
  });

  it("returns ok:false when agent_id is missing", async () => {
    const result = await aggregateGuardrailEventsTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is empty string", async () => {
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is null", async () => {
    const result = await aggregateGuardrailEventsTool.run(null, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns empty groups and 0 total when no artifacts", async () => {
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it("returns empty groups when artifacts have no guardrail events", async () => {
    await ctx.memory.saveArtifacts([makeArtifact("task-1", "agent-1", [])]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it("groups by (type, reason) and sums count", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "customer identifier in output", count: 5 },
        { type: "pii_block", reason: "customer identifier in output", count: 3 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toHaveLength(1);
      expect(result.data.groups[0]?.type).toBe("pii_block");
      expect(result.data.groups[0]?.count).toBe(8);
      expect(result.data.total).toBe(8);
    }
  });

  it("an event with no count field counts as 1", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "content_block", reason: "profanity detected" },
        { type: "content_block", reason: "profanity detected" },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups[0]?.count).toBe(2);
      expect(result.data.total).toBe(2);
    }
  });

  it("separates groups by different reason for same type", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "reason-a", count: 2 },
        { type: "pii_block", reason: "reason-b", count: 3 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toHaveLength(2);
      expect(result.data.total).toBe(5);
    }
  });

  it("separates groups by different type for same reason", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "type-a", reason: "same reason", count: 1 },
        { type: "type-b", reason: "same reason", count: 1 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toHaveLength(2);
    }
  });

  it("filters by type when provided", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "reason-a", count: 5 },
        { type: "content_block", reason: "reason-b", count: 3 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({
      agent_id: "agent-1",
      type: "pii_block",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toHaveLength(1);
      expect(result.data.groups[0]?.type).toBe("pii_block");
      expect(result.data.total).toBe(5);
    }
  });

  it("sorts groups by count DESC then type ASC then reason ASC", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "b_type", reason: "z_reason", count: 1 },
        { type: "a_type", reason: "a_reason", count: 3 },
        { type: "a_type", reason: "b_reason", count: 3 },
        { type: "c_type", reason: "a_reason", count: 2 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const groups = result.data.groups;
      expect(groups[0]?.type).toBe("a_type");
      expect(groups[0]?.reason).toBe("a_reason");
      expect(groups[1]?.type).toBe("a_type");
      expect(groups[1]?.reason).toBe("b_reason");
      expect(groups[2]?.type).toBe("c_type");
      expect(groups[3]?.type).toBe("b_type");
    }
  });

  it("aggregates events across multiple artifacts", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "identifier", count: 5 },
      ]),
      makeArtifact("task-2", "agent-1", [
        { type: "pii_block", reason: "identifier", count: 8 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups).toHaveLength(1);
      expect(result.data.groups[0]?.count).toBe(13);
      expect(result.data.total).toBe(13);
    }
  });

  it("does not include events from other agents", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [{ type: "pii_block", reason: "reason", count: 5 }]),
      makeArtifact("task-2", "agent-2", [{ type: "pii_block", reason: "reason", count: 99 }]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(5);
    }
  });

  it("keeps first non-empty time_window for a group", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "reason", count: 1, time_window: "week" },
        { type: "pii_block", reason: "reason", count: 2 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups[0]?.time_window).toBe("week");
    }
  });

  it("omits time_window field entirely when no events have it", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "pii_block", reason: "reason", count: 1 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // exactOptionalPropertyTypes: field must be absent, not undefined
      expect("time_window" in (result.data.groups[0] ?? {})).toBe(false);
    }
  });

  it("total equals sum of all group counts", async () => {
    await ctx.memory.saveArtifacts([
      makeArtifact("task-1", "agent-1", [
        { type: "type-a", reason: "r-a", count: 3 },
        { type: "type-b", reason: "r-b", count: 7 },
      ]),
    ]);
    const result = await aggregateGuardrailEventsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sumOfGroupCounts = result.data.groups.reduce((s, g) => s + g.count, 0);
      expect(result.data.total).toBe(sumOfGroupCounts);
      expect(result.data.total).toBe(10);
    }
  });
});
