import { describe, it, expect } from "vitest";
import {
  validateAuditArtifact,
  validateToolFact,
  validateActionTaken,
  validateMemoryWrite,
  validateGuardrailEvent,
  validateVerificationArtifact,
  validateSourceRef,
} from "../audit-artifact.js";

const validToolFact = {
  tool: "policy_search",
  status: "success",
  fact: "Enterprise refund exception exists",
};

const validActionTaken = {
  type: "customer_reply",
  visibility: "external",
  reversible: false,
};

const validMemoryWrite = {
  store: "long_term_memory",
  content_summary: "stored user contact details",
  sensitive_entity_types: ["phone_number"],
};

const validGuardrailEvent = {
  type: "privacy_guard_block",
  reason: "attempted to include customer email in external Slack post",
};

const validVerificationArtifact = {
  type: "metric_check",
  status: "passed",
  summary: "CPU back below threshold",
};

const validSourceRef = {
  source: "arize",
  external_id: "trace_abc123",
  label: "production",
};

const validArtifact = {
  task_id: "task_123",
  agent_id: "support_agent",
  timestamp: "2026-05-28T12:00:00Z",
  user_input_summary: "Enterprise customer asks for refund",
  declared_goal: "Answer refund eligibility question",
  final_output_summary: "Refund denied due to 14-day policy",
  tool_facts: [validToolFact],
  agent_status: "resolved",
  actions_taken: [validActionTaken],
  sensitive_entity_types: ["email", "order_id"],
  memory_writes: [],
  guardrail_events: [],
};

describe("validateToolFact", () => {
  it("accepts valid tool fact", () => {
    expect(validateToolFact(validToolFact).ok).toBe(true);
  });

  it("rejects non-object", () => {
    expect(validateToolFact(null).ok).toBe(false);
    expect(validateToolFact("x").ok).toBe(false);
  });

  it("rejects missing tool", () => {
    const result = validateToolFact({ status: "success", fact: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("tool"))).toBe(true);
  });

  it("rejects invalid status enum", () => {
    const result = validateToolFact({ ...validToolFact, status: "pending" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects all invalid tool statuses", () => {
    for (const bad of ["done", "error", "ok", "running"]) {
      expect(validateToolFact({ ...validToolFact, status: bad }).ok).toBe(false);
    }
  });

  it("accepts all valid tool statuses", () => {
    for (const s of ["success", "failed", "blocked", "partial", "unknown"]) {
      expect(validateToolFact({ ...validToolFact, status: s }).ok).toBe(true);
    }
  });

  it("rejects missing fact", () => {
    const result = validateToolFact({ tool: "x", status: "success" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("fact"))).toBe(true);
  });
});

describe("validateActionTaken", () => {
  it("accepts valid action", () => {
    expect(validateActionTaken(validActionTaken).ok).toBe(true);
  });

  it("accepts action with optional target", () => {
    const result = validateActionTaken({ ...validActionTaken, target: "customer" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.target).toBe("customer");
  });

  it("omits target when not provided", () => {
    const result = validateActionTaken(validActionTaken);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.target).toBeUndefined();
  });

  it("rejects invalid visibility", () => {
    const result = validateActionTaken({ ...validActionTaken, visibility: "secret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("visibility"))).toBe(true);
  });

  it("accepts all valid visibility values", () => {
    for (const v of ["internal", "external", "private", "public", "unknown"]) {
      expect(validateActionTaken({ ...validActionTaken, visibility: v }).ok).toBe(true);
    }
  });

  it("rejects non-boolean reversible", () => {
    const result = validateActionTaken({ ...validActionTaken, reversible: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("reversible"))).toBe(true);
  });

  it("rejects target that is not a string when provided", () => {
    const result = validateActionTaken({ ...validActionTaken, target: 123 });
    expect(result.ok).toBe(false);
  });
});

describe("validateMemoryWrite", () => {
  it("accepts valid memory write", () => {
    expect(validateMemoryWrite(validMemoryWrite).ok).toBe(true);
  });

  it("accepts optional retention_risk", () => {
    const result = validateMemoryWrite({ ...validMemoryWrite, retention_risk: "high" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.retention_risk).toBe("high");
  });

  it("rejects invalid retention_risk", () => {
    const result = validateMemoryWrite({ ...validMemoryWrite, retention_risk: "extreme" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("retention_risk"))).toBe(true);
  });

  it("accepts all valid retention_risk values", () => {
    for (const r of ["low", "medium", "high", "critical"]) {
      expect(validateMemoryWrite({ ...validMemoryWrite, retention_risk: r }).ok).toBe(true);
    }
  });

  it("rejects missing store", () => {
    const { store: _, ...rest } = validMemoryWrite;
    expect(validateMemoryWrite(rest).ok).toBe(false);
  });

  it("rejects missing content_summary", () => {
    const { content_summary: _, ...rest } = validMemoryWrite;
    expect(validateMemoryWrite(rest).ok).toBe(false);
  });

  it("defaults missing sensitive_entity_types to an empty list", () => {
    const { sensitive_entity_types: _, ...rest } = validMemoryWrite;
    const result = validateMemoryWrite(rest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sensitive_entity_types).toEqual([]);
  });
});

describe("validateGuardrailEvent", () => {
  it("accepts valid event", () => {
    expect(validateGuardrailEvent(validGuardrailEvent).ok).toBe(true);
  });

  it("accepts optional count and time_window", () => {
    const result = validateGuardrailEvent({ ...validGuardrailEvent, count: 5, time_window: "7d" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.count).toBe(5);
      expect(result.value.time_window).toBe("7d");
    }
  });

  it("rejects missing type", () => {
    expect(validateGuardrailEvent({ reason: "x" }).ok).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(validateGuardrailEvent({ type: "x" }).ok).toBe(false);
  });

  it("rejects non-number count when provided", () => {
    const result = validateGuardrailEvent({ ...validGuardrailEvent, count: "five" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("count"))).toBe(true);
  });
});

describe("validateVerificationArtifact", () => {
  it("accepts valid artifact", () => {
    expect(validateVerificationArtifact(validVerificationArtifact).ok).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = validateVerificationArtifact({ ...validVerificationArtifact, status: "ok" });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid statuses", () => {
    for (const s of ["passed", "failed", "missing", "unknown"]) {
      expect(validateVerificationArtifact({ ...validVerificationArtifact, status: s }).ok).toBe(true);
    }
  });

  it("rejects missing summary", () => {
    const { summary: _, ...rest } = validVerificationArtifact;
    expect(validateVerificationArtifact(rest).ok).toBe(false);
  });
});

describe("validateSourceRef", () => {
  it("accepts valid source ref with all fields", () => {
    expect(validateSourceRef(validSourceRef).ok).toBe(true);
  });

  it("accepts minimal source ref (source only)", () => {
    expect(validateSourceRef({ source: "seed" }).ok).toBe(true);
  });

  it("rejects invalid source", () => {
    const result = validateSourceRef({ source: "phoenix" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("source"))).toBe(true);
  });

  it("accepts all valid source values", () => {
    for (const s of ["arize", "seed", "other"]) {
      expect(validateSourceRef({ source: s }).ok).toBe(true);
    }
  });

  it("rejects non-string external_id when provided", () => {
    const result = validateSourceRef({ source: "arize", external_id: 42 });
    expect(result.ok).toBe(false);
  });
});

describe("validateAuditArtifact", () => {
  it("accepts a fully valid artifact", () => {
    const result = validateAuditArtifact(validArtifact);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task_id).toBe("task_123");
      expect(result.value.agent_status).toBe("resolved");
      expect(result.value.customer_input_summary).toBe(validArtifact.user_input_summary);
      expect(result.value.company_task).toBe(validArtifact.declared_goal);
      expect(result.value.customer_goal).toBe(validArtifact.user_input_summary);
      expect(result.value.final_response_summary).toBe(validArtifact.final_output_summary);
    }
  });

  it("accepts artifact with all optional fields", () => {
    const result = validateAuditArtifact({
      ...validArtifact,
      task_type: "support",
      agent_confidence: 0.91,
      conversation_signals: ["customer asked for a human"],
      operational_signals: ["verification failed after resolved status"],
      business_signals: ["repeat contact"],
      support_context: {
        case_id: "case-1",
        issue_category: "refund",
        channel: "chat",
        prior_contact_count: 2,
        thumbs_down: true,
        escalation_requested: true,
      },
      verification_artifacts: [validVerificationArtifact],
      source_refs: [validSourceRef],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task_type).toBe("support");
      expect(result.value.agent_confidence).toBe(0.91);
      expect(result.value.conversation_signals).toContain("customer asked for a human");
      expect(result.value.support_context?.prior_contact_count).toBe(2);
      expect(result.value.support_context?.thumbs_down).toBe(true);
    }
  });

  it("accepts service-first field names and fills legacy aliases", () => {
    const result = validateAuditArtifact({
      task_id: "task_service",
      agent_id: "support_agent",
      timestamp: "2026-05-28T12:00:00Z",
      customer_input_summary: "Customer wants cancellation after repeated self-service attempts",
      company_task: "Resolve cancellation request",
      customer_goal: "Cancel without more effort",
      final_response_summary: "Sent customer back to the portal",
      tool_facts: [],
      agent_status: "resolved",
      actions_taken: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user_input_summary).toBe(result.value.customer_input_summary);
      expect(result.value.declared_goal).toBe(result.value.company_task);
      expect(result.value.final_output_summary).toBe(result.value.final_response_summary);
      expect(result.value.sensitive_entity_types).toEqual([]);
      expect(result.value.memory_writes).toEqual([]);
      expect(result.value.guardrail_events).toEqual([]);
    }
  });

  it("omits optional fields when absent", () => {
    const result = validateAuditArtifact(validArtifact);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task_type).toBeUndefined();
      expect(result.value.agent_confidence).toBeUndefined();
      expect(result.value.verification_artifacts).toBeUndefined();
      expect(result.value.source_refs).toBeUndefined();
    }
  });

  it("rejects null input", () => {
    expect(validateAuditArtifact(null).ok).toBe(false);
  });

  it("rejects missing task_id", () => {
    const { task_id: _, ...rest } = validArtifact;
    const result = validateAuditArtifact(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("task_id"))).toBe(true);
  });

  it("rejects missing agent_id", () => {
    const { agent_id: _, ...rest } = validArtifact;
    expect(validateAuditArtifact(rest).ok).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const { timestamp: _, ...rest } = validArtifact;
    expect(validateAuditArtifact(rest).ok).toBe(false);
  });

  it("rejects invalid agent_status", () => {
    const result = validateAuditArtifact({ ...validArtifact, agent_status: "done" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("agent_status"))).toBe(true);
  });

  it("accepts all valid agent_status values", () => {
    for (const s of ["resolved", "failed", "blocked", "needs_review", "unknown"]) {
      expect(validateAuditArtifact({ ...validArtifact, agent_status: s }).ok).toBe(true);
    }
  });

  it("rejects non-array tool_facts", () => {
    const result = validateAuditArtifact({ ...validArtifact, tool_facts: "bad" });
    expect(result.ok).toBe(false);
  });

  it("rejects tool_facts with invalid elements", () => {
    const result = validateAuditArtifact({ ...validArtifact, tool_facts: [{ tool: "", status: "bad" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects non-number agent_confidence when provided", () => {
    const result = validateAuditArtifact({ ...validArtifact, agent_confidence: "high" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("agent_confidence"))).toBe(true);
  });

  it("rejects actions_taken with invalid visibility", () => {
    const badAction = { ...validActionTaken, visibility: "hidden" };
    const result = validateAuditArtifact({ ...validArtifact, actions_taken: [badAction] });
    expect(result.ok).toBe(false);
  });

  it("rejects memory_writes that are not arrays", () => {
    const result = validateAuditArtifact({ ...validArtifact, memory_writes: null });
    expect(result.ok).toBe(false);
  });

  it("rejects guardrail_events with invalid elements", () => {
    const result = validateAuditArtifact({ ...validArtifact, guardrail_events: [{ type: "" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid support_context fields", () => {
    const result = validateAuditArtifact({
      ...validArtifact,
      support_context: { prior_contact_count: "two" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("support_context.prior_contact_count"))).toBe(true);
  });
});
