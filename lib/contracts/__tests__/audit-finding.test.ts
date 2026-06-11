import { describe, it, expect } from "vitest";
import { validateLensFindingDraft, validateAuditFinding } from "../audit-finding.js";

const validDraft = {
  task_id: "task_123",
  agent_id: "support_agent",
  lens: "Evidence-Output Audit",
  failure_mode: "Evidence-Output Contradiction",
  severity: "high",
  confidence: 0.87,
  evidence: ["Policy search returned an enterprise exception"],
  recommended_action: "Review refund-policy response behavior",
  human_review_required: true,
};

const validFinding = {
  finding_id: "finding_456",
  task_id: "task_123",
  agent_id: "support_agent",
  lens: "Evidence-Output Audit",
  failure_mode: "Evidence-Output Contradiction",
  severity: "high",
  confidence: 0.87,
  evidence: ["Policy search returned an enterprise exception"],
  evidence_keywords: ["policy", "enterprise", "exception"],
  recommended_action: "Review refund-policy response behavior",
  human_review_required: true,
  converted_to_eval: false,
  created_at: "2026-05-28T12:00:00Z",
  updated_at: "2026-05-28T12:00:00Z",
};

describe("validateLensFindingDraft", () => {
  it("accepts a valid draft", () => {
    const result = validateLensFindingDraft(validDraft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lens).toBe("Evidence-Output Audit");
  });

  it("rejects non-object input", () => {
    expect(validateLensFindingDraft(null).ok).toBe(false);
    expect(validateLensFindingDraft(42).ok).toBe(false);
  });

  it("rejects missing task_id", () => {
    const { task_id: _, ...rest } = validDraft;
    const result = validateLensFindingDraft(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("task_id"))).toBe(true);
  });

  it("rejects missing agent_id", () => {
    const { agent_id: _, ...rest } = validDraft;
    expect(validateLensFindingDraft(rest).ok).toBe(false);
  });

  it("rejects missing lens", () => {
    const { lens: _, ...rest } = validDraft;
    expect(validateLensFindingDraft(rest).ok).toBe(false);
  });

  it("rejects missing failure_mode", () => {
    const { failure_mode: _, ...rest } = validDraft;
    expect(validateLensFindingDraft(rest).ok).toBe(false);
  });

  it("rejects invalid severity", () => {
    const result = validateLensFindingDraft({ ...validDraft, severity: "extreme" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
  });

  it("accepts all valid severity values", () => {
    for (const s of ["low", "medium", "high", "critical"]) {
      expect(validateLensFindingDraft({ ...validDraft, severity: s }).ok).toBe(true);
    }
  });

  it("rejects confidence below 0", () => {
    const result = validateLensFindingDraft({ ...validDraft, confidence: -0.1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
  });

  it("rejects confidence above 1", () => {
    const result = validateLensFindingDraft({ ...validDraft, confidence: 1.1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
  });

  it("accepts confidence at boundary values 0 and 1", () => {
    expect(validateLensFindingDraft({ ...validDraft, confidence: 0 }).ok).toBe(true);
    expect(validateLensFindingDraft({ ...validDraft, confidence: 1 }).ok).toBe(true);
  });

  it("rejects non-number confidence", () => {
    expect(validateLensFindingDraft({ ...validDraft, confidence: "high" }).ok).toBe(false);
  });

  it("rejects evidence that is not string array", () => {
    const result = validateLensFindingDraft({ ...validDraft, evidence: [1, 2] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("evidence"))).toBe(true);
  });

  it("accepts empty evidence array", () => {
    expect(validateLensFindingDraft({ ...validDraft, evidence: [] }).ok).toBe(true);
  });

  it("rejects missing recommended_action", () => {
    const { recommended_action: _, ...rest } = validDraft;
    expect(validateLensFindingDraft(rest).ok).toBe(false);
  });

  it("rejects non-boolean human_review_required", () => {
    const result = validateLensFindingDraft({ ...validDraft, human_review_required: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("human_review_required"))).toBe(true);
  });
});

describe("validateAuditFinding", () => {
  it("accepts a valid finding", () => {
    const result = validateAuditFinding(validFinding);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.finding_id).toBe("finding_456");
      expect(result.value.converted_to_eval).toBe(false);
    }
  });

  it("rejects non-object input", () => {
    expect(validateAuditFinding(null).ok).toBe(false);
  });

  it("rejects missing finding_id", () => {
    const { finding_id: _, ...rest } = validFinding;
    const result = validateAuditFinding(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("finding_id"))).toBe(true);
  });

  it("rejects missing evidence_keywords", () => {
    const { evidence_keywords: _, ...rest } = validFinding;
    const result = validateAuditFinding(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("evidence_keywords"))).toBe(true);
  });

  it("rejects missing created_at", () => {
    const { created_at: _, ...rest } = validFinding;
    expect(validateAuditFinding(rest).ok).toBe(false);
  });

  it("rejects missing updated_at", () => {
    const { updated_at: _, ...rest } = validFinding;
    expect(validateAuditFinding(rest).ok).toBe(false);
  });

  it("rejects missing converted_to_eval", () => {
    const { converted_to_eval: _, ...rest } = validFinding;
    expect(validateAuditFinding(rest).ok).toBe(false);
  });

  it("accepts optional cluster_id", () => {
    const result = validateAuditFinding({ ...validFinding, cluster_id: "cluster_abc" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cluster_id).toBe("cluster_abc");
  });

  it("omits cluster_id when absent", () => {
    const result = validateAuditFinding(validFinding);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cluster_id).toBeUndefined();
  });

  it("rejects confidence below 0", () => {
    const result = validateAuditFinding({ ...validFinding, confidence: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const result = validateAuditFinding({ ...validFinding, confidence: 2 });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid severity", () => {
    const result = validateAuditFinding({ ...validFinding, severity: "ultra" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-boolean converted_to_eval", () => {
    const result = validateAuditFinding({ ...validFinding, converted_to_eval: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects evidence_keywords that is not string array", () => {
    const result = validateAuditFinding({ ...validFinding, evidence_keywords: [1, 2] });
    expect(result.ok).toBe(false);
  });

  it("accepts empty evidence and evidence_keywords arrays", () => {
    const result = validateAuditFinding({ ...validFinding, evidence: [], evidence_keywords: [] });
    expect(result.ok).toBe(true);
  });
});
