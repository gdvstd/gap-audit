import { describe, it, expect } from "vitest";
import { validateReviewDecision } from "../review-decision.js";

const valid = {
  finding_id: "finding_456",
  decision: "confirmed",
  reviewer_id: "reviewer_001",
  reason: "Policy evidence clearly contradicts the output",
  decided_at: "2026-05-28T14:00:00Z",
};

describe("validateReviewDecision", () => {
  it("accepts a fully valid decision", () => {
    const result = validateReviewDecision(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.finding_id).toBe("finding_456");
      expect(result.value.decision).toBe("confirmed");
    }
  });

  it("accepts minimal decision without optional fields", () => {
    const result = validateReviewDecision({
      finding_id: "finding_789",
      decision: "dismissed",
      decided_at: "2026-05-28T14:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewer_id).toBeUndefined();
      expect(result.value.reason).toBeUndefined();
    }
  });

  it("rejects non-object input", () => {
    expect(validateReviewDecision(null).ok).toBe(false);
    expect(validateReviewDecision("confirmed").ok).toBe(false);
  });

  it("rejects missing finding_id", () => {
    const { finding_id: _, ...rest } = valid;
    const result = validateReviewDecision(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("finding_id"))).toBe(true);
  });

  it("rejects empty finding_id", () => {
    const result = validateReviewDecision({ ...valid, finding_id: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing decision", () => {
    const { decision: _, ...rest } = valid;
    const result = validateReviewDecision(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("decision"))).toBe(true);
  });

  it("rejects invalid decision value", () => {
    const result = validateReviewDecision({ ...valid, decision: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("decision"))).toBe(true);
  });

  it("accepts all valid decision values", () => {
    for (const d of ["confirmed", "dismissed"]) {
      expect(validateReviewDecision({ ...valid, decision: d }).ok).toBe(true);
    }
  });

  it("rejects missing decided_at", () => {
    const { decided_at: _, ...rest } = valid;
    const result = validateReviewDecision(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("decided_at"))).toBe(true);
  });

  it("rejects non-string reviewer_id when provided", () => {
    const result = validateReviewDecision({ ...valid, reviewer_id: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("reviewer_id"))).toBe(true);
  });

  it("rejects non-string reason when provided", () => {
    const result = validateReviewDecision({ ...valid, reason: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("reason"))).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const result = validateReviewDecision({ finding_id: "", decision: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
