import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import { extractConversationSignalsTool } from "../extract-conversation-signals.js";
import type { ToolContext } from "../types.js";

function makeArtifact(overrides: Partial<AuditArtifact> = {}): AuditArtifact {
  return {
    task_id: "task-1",
    agent_id: "agent-support",
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary:
      "I already tried the billing portal twice and contacted support. I want a human because this is frustrating. Call me at +1-415-555-0123.",
    declared_goal: "Resolve cancellation request without forcing repeat self-service.",
    final_output_summary:
      "Sorry for the inconvenience. You can cancel from Settings > Billing using the self-service link.",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("extractConversationSignalsTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name and schema", () => {
    expect(extractConversationSignalsTool.name).toBe("extract_conversation_signals");
    expect(extractConversationSignalsTool.inputSchema.required).toContain("task_id");
  });

  it("returns ok:false for missing task_id", async () => {
    const result = await extractConversationSignalsTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for unknown artifact", async () => {
    const result = await extractConversationSignalsTool.run({ task_id: "missing" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("extracts customer-experience signals and counts", async () => {
    await ctx.memory.saveArtifacts([makeArtifact()]);

    const result = await extractConversationSignalsTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kinds = new Set(result.data.signals.map((signal) => signal.kind));
    expect(kinds.has("human_request")).toBe(true);
    expect(kinds.has("frustration")).toBe(true);
    expect(kinds.has("already_tried")).toBe(true);
    expect(kinds.has("self_service_loop")).toBe(true);
    expect(kinds.has("churn_or_cancellation_intent")).toBe(true);
    expect(kinds.has("apology_without_action")).toBe(true);
    expect(result.data.counts.human_request).toBeGreaterThan(0);
  });

  it("returns concise evidence snippets without redaction masking", async () => {
    await ctx.memory.saveArtifacts([makeArtifact()]);

    const result = await extractConversationSignalsTool.run({ task_id: "task-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const evidence = result.data.signals.map((signal) => signal.evidence).join("\n");
    expect(evidence).toContain("+1-415-555-0123");
    expect(evidence).not.toContain("[phone_number detected");
  });

  it("can suppress evidence while preserving counts", async () => {
    await ctx.memory.saveArtifacts([makeArtifact()]);

    const result = await extractConversationSignalsTool.run({
      task_id: "task-1",
      include_evidence: false,
    }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.signals.length).toBeGreaterThan(0);
    expect(result.data.signals.every((signal) => signal.evidence === "")).toBe(true);
    expect(result.data.counts.human_request).toBeGreaterThan(0);
  });
});
