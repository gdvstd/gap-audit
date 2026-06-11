import { describe, it, expect, beforeEach } from "vitest";
import { getArtifactTool } from "../get-artifact.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { ToolContext } from "../types.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

function makeArtifact(task_id: string, agent_id = "agent-1"): AuditArtifact {
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
    guardrail_events: [],
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("getArtifactTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name", () => {
    expect(getArtifactTool.name).toBe("get_artifact");
  });

  it("has a non-empty description", () => {
    expect(getArtifactTool.description.length).toBeGreaterThan(0);
  });

  it("has a valid inputSchema with task_id required", () => {
    expect(getArtifactTool.inputSchema.type).toBe("object");
    expect(getArtifactTool.inputSchema.required).toContain("task_id");
  });

  it("returns ok with null artifact when task_id not found", async () => {
    const result = await getArtifactTool.run({ task_id: "nonexistent" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact).toBeNull();
    }
  });

  it("returns ok with artifact when task_id exists", async () => {
    await ctx.memory.saveArtifacts([makeArtifact("task-1")]);
    const result = await getArtifactTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact).not.toBeNull();
      expect(result.data.artifact?.task_id).toBe("task-1");
    }
  });

  it("returns ok:false when task_id is missing", async () => {
    const result = await getArtifactTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when task_id is empty string", async () => {
    const result = await getArtifactTool.run({ task_id: "" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when task_id is not a string", async () => {
    const result = await getArtifactTool.run({ task_id: 42 }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when task_id is null", async () => {
    const result = await getArtifactTool.run({ task_id: null }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is null", async () => {
    const result = await getArtifactTool.run(null, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is a string", async () => {
    const result = await getArtifactTool.run("task-1", ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is undefined", async () => {
    const result = await getArtifactTool.run(undefined, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns stored service artifact fields without masking", async () => {
    const a = makeArtifact("task-service-1");
    a.customer_input_summary = "I already tried the portal and want a human.";
    a.customer_goal = "Cancel without repeating self-service.";
    a.company_task = "Resolve cancellation request.";
    a.final_response_summary = "Please use Settings > Billing.";
    a.conversation_signals = ["already tried self-service", "human requested"];
    await ctx.memory.saveArtifacts([a]);
    const result = await getArtifactTool.run({ task_id: "task-service-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact?.customer_goal).toBe("Cancel without repeating self-service.");
      expect(result.data.artifact?.conversation_signals).toContain("human requested");
      expect(result.data.artifact?.final_response_summary).toContain("Settings > Billing");
    }
  });

  it("does not reinterpret raw strings at read time", async () => {
    const a = makeArtifact("task-raw-1");
    a.user_input_summary = "Reach me at jane.doe@example.com or 415-555-0142.";
    a.final_output_summary = "Key leaked: sk-ABCDEFGHIJKLMNOP1234 in the log.";
    await ctx.memory.saveArtifacts([a]);
    const result = await getArtifactTool.run({ task_id: "task-raw-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blob = JSON.stringify(result.data.artifact);
      expect(blob).toContain("jane.doe@example.com");
      expect(blob).toContain("sk-ABCDEFGHIJKLMNOP1234");
      expect(blob).not.toContain("[email detected");
    }
  });

  it("returns null rather than transforming missing artifacts", async () => {
    const result = await getArtifactTool.run({ task_id: "task-missing-service" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact).toBeNull();
    }
  });
});
