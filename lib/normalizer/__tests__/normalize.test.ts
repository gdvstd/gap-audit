import { describe, it, expect } from "vitest";
import { normalizeRawTrace } from "../normalize.js";
import type { RawTraceArtifact, RawSpan } from "../raw-trace.js";
import { validateAuditArtifact } from "../../contracts/audit-artifact.js";

function makeMinimalRaw(overrides?: Partial<RawTraceArtifact>): RawTraceArtifact {
  return {
    trace_id: "trace-001",
    agent_id: "agent-test-01",
    started_at: "2026-05-28T10:00:00Z",
    spans: [],
    ...overrides,
  };
}

function makeToolSpan(overrides?: Partial<RawSpan>): RawSpan {
  return {
    span_id: "span-tool-1",
    kind: "tool",
    name: "policy-lookup",
    start_time: "2026-05-28T10:00:01Z",
    status: "ok",
    output: "Policy found: refund within 30 days.",
    ...overrides,
  };
}

function makeMemorySpan(overrides?: Partial<RawSpan>): RawSpan {
  return {
    span_id: "span-mem-1",
    kind: "memory",
    name: "memory-write",
    start_time: "2026-05-28T10:00:02Z",
    output: "Stored user preferences.",
    attributes: { store: "user-prefs" },
    ...overrides,
  };
}

function makeGuardrailSpan(overrides?: Partial<RawSpan>): RawSpan {
  return {
    span_id: "span-guard-1",
    kind: "guardrail",
    name: "pii-filter",
    start_time: "2026-05-28T10:00:03Z",
    status: "blocked",
    attributes: { reason: "Attempted to include customer ID in external reply." },
    ...overrides,
  };
}

function makeVerificationSpan(overrides?: Partial<RawSpan>): RawSpan {
  return {
    span_id: "span-verify-1",
    kind: "agent",
    name: "verify-metrics",
    start_time: "2026-05-28T10:00:04Z",
    output: "Metrics not yet recovered.",
    attributes: {
      verification_type: "metric-recovery",
      verification_status: "missing",
    },
    ...overrides,
  };
}

describe("normalizeRawTrace — happy path", () => {
  it("produces a valid AuditArtifact from a minimal raw trace", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Help user.",
      user_input: "I need help.",
      final_output: "Here is the help.",
      agent_status: "resolved",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateAuditArtifact(result.value);
    expect(validation.ok).toBe(true);
  });

  it("passes task_id from trace_id", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_id).toBe("trace-001");
  });

  it("passes agent_id and task_type through", () => {
    const raw = makeMinimalRaw({
      task_type: "refund-request",
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_id).toBe("agent-test-01");
    expect(result.value.task_type).toBe("refund-request");
  });

  it("maps service-first fields into GapAudit artifact fields and legacy aliases", () => {
    const raw = makeMinimalRaw({
      task_type: "cancellation",
      customer_input: "I already tried the portal and want to cancel.",
      company_task: "Resolve cancellation request.",
      customer_goal: "Cancel without repeating self-service.",
      final_response: "Please use Settings > Billing.",
      conversation_signals: ["already tried self-service", "human requested"],
      operational_signals: ["resolved with self-service loop"],
      business_signals: ["repeat contact risk"],
      support_context: {
        case_id: "case-123",
        issue_category: "cancellation",
        channel: "chat",
        prior_contact_count: 2,
        thumbs_down: true,
      },
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.customer_input_summary).toBe("I already tried the portal and want to cancel.");
    expect(result.value.company_task).toBe("Resolve cancellation request.");
    expect(result.value.customer_goal).toBe("Cancel without repeating self-service.");
    expect(result.value.final_response_summary).toBe("Please use Settings > Billing.");
    expect(result.value.user_input_summary).toBe(result.value.customer_input_summary);
    expect(result.value.declared_goal).toBe(result.value.company_task);
    expect(result.value.final_output_summary).toBe(result.value.final_response_summary);
    expect(result.value.conversation_signals).toContain("human requested");
    expect(result.value.operational_signals).toContain("resolved with self-service loop");
    expect(result.value.business_signals).toContain("repeat contact risk");
    expect(result.value.support_context?.prior_contact_count).toBe(2);
    expect(result.value.support_context?.thumbs_down).toBe(true);
  });

  it("uses started_at as timestamp", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timestamp).toBe("2026-05-28T10:00:00Z");
  });

  it("passes agent_confidence through", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      agent_confidence: 0.87,
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_confidence).toBe(0.87);
  });

  it("maps known agent_status values to AgentStatus enum", () => {
    for (const status of ["resolved", "failed", "blocked", "needs_review", "unknown"]) {
      const raw = makeMinimalRaw({
        declared_goal: "Goal.",
        user_input: "Input.",
        final_output: "Output.",
        agent_status: status,
      });
      const result = normalizeRawTrace(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.agent_status).toBe(status);
    }
  });

  it("maps unknown agent_status to 'unknown'", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      agent_status: "in_progress",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_status).toBe("unknown");
  });

  it("defaults missing agent_status to 'unknown'", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_status).toBe("unknown");
  });
});

describe("normalizeRawTrace — tool_facts extraction", () => {
  it("extracts tool facts from tool spans", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Look up policy.",
      user_input: "Refund request.",
      final_output: "Denied.",
      spans: [makeToolSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts).toHaveLength(1);
    expect(result.value.tool_facts[0]?.tool).toBe("policy-lookup");
  });

  it("maps span status 'ok' to tool status 'success'", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeToolSpan({ status: "ok" })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts[0]?.status).toBe("success");
  });

  it("maps span status 'error' to tool status 'failed'", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeToolSpan({ status: "error" })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts[0]?.status).toBe("failed");
  });

  it("defaults unknown span status to tool status 'unknown'", () => {
    const spanNoStatus: RawSpan = {
      span_id: "span-no-status",
      kind: "tool",
      name: "lookup",
      start_time: "2026-05-28T10:00:01Z",
      output: "result",
    };
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [spanNoStatus],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts[0]?.status).toBe("unknown");
  });

  it("truncates fact to 280 chars max", () => {
    const longOutput = "X".repeat(500);
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeToolSpan({ output: longOutput })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts[0]?.fact.length).toBeLessThanOrEqual(280);
  });

  it("produces valid AuditArtifact with tool facts", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeToolSpan(), makeToolSpan({ span_id: "span-tool-2", name: "account-lookup" })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts).toHaveLength(2);
    const validation = validateAuditArtifact(result.value);
    expect(validation.ok).toBe(true);
  });
});

describe("normalizeRawTrace — memory_writes extraction", () => {
  it("extracts memory writes from memory spans", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeMemorySpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memory_writes).toHaveLength(1);
    expect(result.value.memory_writes[0]?.store).toBe("user-prefs");
  });

  it("preserves memory span content and accepts explicit sensitive tags", () => {
    const phoneInMemory = "Stored candidate phone: 555-867-5309 and salary: $120k";
    const raw = makeMinimalRaw({
      declared_goal: "Store candidate data.",
      user_input: "Candidate info.",
      final_output: "Stored.",
      spans: [
        makeMemorySpan({
          output: phoneInMemory,
          attributes: { store: "user-prefs", sensitive_entity_types: ["phone_number"] },
        }),
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mw = result.value.memory_writes[0];
    expect(mw).toBeDefined();
    if (!mw) return;
    expect(mw.content_summary).toContain("555-867-5309");
    expect(mw.sensitive_entity_types).toContain("phone_number");
  });

  it("collects explicit sensitive_entity_types metadata into artifact tags", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Store data.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        makeMemorySpan({
          output: "Email: recruiter@company.com stored.",
          attributes: { store: "user-prefs", sensitive_entity_types: ["email"] },
        }),
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sensitive_entity_types).toContain("email");
  });

  it("uses retention_risk from attributes when valid", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeMemorySpan({ attributes: { store: "user-prefs", retention_risk: "high" } })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memory_writes[0]?.retention_risk).toBe("high");
  });

  it("omits retention_risk when attribute is invalid", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeMemorySpan({ attributes: { store: "s", retention_risk: "extreme" } })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memory_writes[0]?.retention_risk).toBeUndefined();
  });

  it("truncates content_summary to 280 chars max", () => {
    const longOutput = "Y".repeat(500);
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeMemorySpan({ output: longOutput })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memory_writes[0]?.content_summary.length).toBeLessThanOrEqual(280);
  });
});

describe("normalizeRawTrace — guardrail_events extraction", () => {
  it("extracts guardrail events from guardrail spans", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeGuardrailSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guardrail_events).toHaveLength(1);
    expect(result.value.guardrail_events[0]?.type).toBe("pii-filter");
  });

  it("sets reason from attributes.reason", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeGuardrailSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guardrail_events[0]?.reason).toBe(
      "Attempted to include customer ID in external reply."
    );
  });

  it("falls back reason to span output when no attributes.reason", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeGuardrailSpan({ attributes: {}, output: "Blocked by policy." })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guardrail_events[0]?.reason).toBe("Blocked by policy.");
  });

  it("includes count and time_window from attributes when present", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        makeGuardrailSpan({
          attributes: {
            reason: "PII blocked",
            count: 23,
            time_window: "2026-05-21T00:00:00Z/2026-05-28T00:00:00Z",
          },
        }),
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ge = result.value.guardrail_events[0];
    expect(ge?.count).toBe(23);
    expect(ge?.time_window).toBe("2026-05-21T00:00:00Z/2026-05-28T00:00:00Z");
  });

  it("produces valid AuditArtifact with guardrail events", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeGuardrailSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateAuditArtifact(result.value);
    expect(validation.ok).toBe(true);
  });
});

describe("normalizeRawTrace — verification_artifacts extraction", () => {
  it("extracts verification artifacts from spans with verification_type attribute", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeVerificationSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification_artifacts).toHaveLength(1);
    expect(result.value.verification_artifacts?.[0]?.type).toBe("metric-recovery");
  });

  it("maps verification_status 'missing' correctly", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeVerificationSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification_artifacts?.[0]?.status).toBe("missing");
  });

  it("defaults unknown verification_status to 'unknown'", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        makeVerificationSpan({
          attributes: { verification_type: "health-check", verification_status: "not_run" },
        }),
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification_artifacts?.[0]?.status).toBe("unknown");
  });

  it("sets summary from span output", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [makeVerificationSpan()],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification_artifacts?.[0]?.summary).toBe("Metrics not yet recovered.");
  });
});

describe("normalizeRawTrace — service artifact mapping", () => {
  it("preserves final response text instead of redacting it", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Reply sent to admin@company.com",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.final_response_summary).toContain("admin@company.com");
    expect(result.value.final_output_summary).toContain("admin@company.com");
    expect(result.value.sensitive_entity_types).toEqual([]);
  });

  it("preserves customer input text instead of redacting it", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "My phone is 555-123-4567",
      final_output: "Got it.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer_input_summary).toContain("555-123-4567");
    expect(result.value.user_input_summary).toContain("555-123-4567");
    expect(result.value.sensitive_entity_types).toEqual([]);
  });

  it("collects and deduplicates explicit sensitive_entity_types across spans", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Email: user@test.com",
      final_output: "Also user@test.com replied.",
      spans: [
        makeToolSpan({
          attributes: { sensitive_entity_types: ["email", "email"] },
        }),
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const emailCount = result.value.sensitive_entity_types.filter((t) => t === "email").length;
    expect(emailCount).toBe(1);
  });

  it("keeps redacted_field_count at zero because mapping does not redact", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Phone: 800-555-1234",
      final_output: "Also email admin@test.com here.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redactions.redacted_field_count).toBe(0);
  });

  it("returns explicit sensitive tags in the compatibility redactions summary", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Phone: 800-555-1234",
      final_output: "Output.",
      spans: [makeToolSpan({ attributes: { sensitive_entity_types: ["phone_number"] } })],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redactions.entity_types).toContain("phone_number");
  });
});

describe("normalizeRawTrace — source_refs", () => {
  it("builds source_refs from raw source field", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      source: { system: "arize", external_id: "ext-123", label: "test-trace" },
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source_refs?.[0]?.source).toBe("arize");
    expect(result.value.source_refs?.[0]?.external_id).toBe("ext-123");
  });

  it("defaults to source 'other' when source field is absent", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source_refs?.[0]?.source).toBe("other");
  });
});

describe("normalizeRawTrace — actions_taken extraction", () => {
  it("extracts actions from spans with attributes.action_type", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        {
          span_id: "span-action-1",
          kind: "tool",
          name: "send-reply",
          start_time: "2026-05-28T10:00:01Z",
          attributes: {
            action_type: "send-reply-to-customer",
            visibility: "external",
            reversible: false,
          },
        },
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.value.actions_taken.find((a) => a.type === "send-reply-to-customer");
    expect(action).toBeDefined();
    expect(action?.visibility).toBe("external");
    expect(action?.reversible).toBe(false);
  });

  it("defaults visibility to 'unknown' when not provided", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        {
          span_id: "span-action-2",
          kind: "tool",
          name: "log-action",
          start_time: "2026-05-28T10:00:01Z",
          attributes: { action_type: "log" },
        },
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.value.actions_taken.find((a) => a.type === "log");
    expect(action?.visibility).toBe("unknown");
  });

  it("defaults reversible to true when not provided", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      spans: [
        {
          span_id: "span-action-3",
          kind: "tool",
          name: "log-action",
          start_time: "2026-05-28T10:00:01Z",
          attributes: { action_type: "log" },
        },
      ],
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.value.actions_taken.find((a) => a.type === "log");
    expect(action?.reversible).toBe(true);
  });
});

describe("normalizeRawTrace — fallback for missing optional raw fields", () => {
  it("falls back user_input_summary to empty string when user_input absent", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user_input_summary).toBe("");
  });

  it("falls back declared_goal to empty string when absent", () => {
    const raw = makeMinimalRaw({
      user_input: "Input.",
      final_output: "Output.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.declared_goal).toBe("");
  });

  it("falls back final_output_summary to empty string when final_output absent", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.final_output_summary).toBe("");
  });

  it("still produces a valid AuditArtifact when all optional text fields absent", () => {
    const raw = makeMinimalRaw();
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateAuditArtifact(result.value);
    expect(validation.ok).toBe(true);
  });
});

describe("normalizeRawTrace — validation failures", () => {
  it("returns ok: false when confidence is outside [0,1]", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      agent_confidence: 1.5,
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(false);
  });

  it("returns ok: false when confidence is negative", () => {
    const raw = makeMinimalRaw({
      declared_goal: "Goal.",
      user_input: "Input.",
      final_output: "Output.",
      agent_confidence: -0.1,
    });
    const result = normalizeRawTrace(raw);
    expect(result.ok).toBe(false);
  });
});

describe("normalizeRawTrace — roundtrip validation", () => {
  it("every happy-path result passes validateAuditArtifact", () => {
    const scenarios: RawTraceArtifact[] = [
      makeMinimalRaw({
        declared_goal: "Look up policy.",
        user_input: "Refund?",
        final_output: "Denied.",
        spans: [makeToolSpan()],
      }),
      makeMinimalRaw({
        declared_goal: "Store data.",
        user_input: "Input.",
        final_output: "Output.",
        spans: [makeMemorySpan({ output: "user@corp.com recorded" })],
      }),
      makeMinimalRaw({
        declared_goal: "Goal.",
        user_input: "Input.",
        final_output: "Output.",
        spans: [makeGuardrailSpan(), makeVerificationSpan()],
        source: { system: "seed", label: "roundtrip-test" },
      }),
    ];

    for (const raw of scenarios) {
      const result = normalizeRawTrace(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const validation = validateAuditArtifact(result.value);
      expect(validation.ok).toBe(true);
    }
  });
});
