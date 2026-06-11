import { describe, it, expect } from "vitest";
import { normalizeRawTrace } from "../normalize.js";
import type { RawTraceArtifact } from "../raw-trace.js";

function makeMinimalRaw(overrides?: Partial<RawTraceArtifact>): RawTraceArtifact {
  return {
    trace_id: "trace-001",
    agent_id: "agent-test-01",
    started_at: "2026-05-28T10:00:00Z",
    spans: [],
    ...overrides,
  };
}

describe("normalizeRawTrace — scope boundary", () => {
  it("does not compute requires_secure_handling from raw text", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Help customer.",
      user_input: "Email me at user@example.com and call 800-555-1234.",
      final_output: "I will follow up.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.requires_secure_handling).toBeUndefined();
    expect(result.value.customer_input_summary).toContain("user@example.com");
    expect(result.redactions.redacted_field_count).toBe(0);
  });

  it("keeps explicit trust-sensitive metadata as tags, not detected redactions", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Save customer context.",
      user_input: "Customer provided contact details.",
      final_output: "Saved details.",
      spans: [
        {
          span_id: "span-mem-1",
          kind: "memory",
          name: "memory-write",
          start_time: "2026-05-28T10:00:02Z",
          output: "Stored customer phone and refund context.",
          attributes: {
            store: "case-memory",
            sensitive_entity_types: ["phone_number"],
            retention_risk: "high",
          },
        },
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.sensitive_entity_types).toContain("phone_number");
    expect(result.value.memory_writes[0]?.retention_risk).toBe("high");
    expect(result.redactions.entity_types).toContain("phone_number");
    expect(result.redactions.redacted_field_count).toBe(0);
  });

  it("validateAuditArtifact accepts normalized artifacts without secure handling metadata", async () => {
    const { validateAuditArtifact } = await import("../../contracts/audit-artifact.js");
    const result = normalizeRawTrace(makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Hello world.",
      final_output: "Output.",
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateAuditArtifact(result.value);
    expect(validation.ok).toBe(true);
  });
});
