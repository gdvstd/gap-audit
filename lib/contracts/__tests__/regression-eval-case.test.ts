import { describe, it, expect } from "vitest";
import { validateRegressionEvalCase } from "../regression-eval-case.js";

const valid = {
  eval_id: "eval_refund_exception_001",
  source_finding_id: "finding_456",
  agent_id: "support_agent",
  input: "Enterprise customer asks for refund after failed onboarding",
  expected_behavior: [
    "Retrieve refund policy",
    "Check enterprise exception",
    "Avoid blanket denial",
  ],
  failure_mode_guarded: "Evidence-Output Contradiction",
  created_at: "2026-05-28T12:00:00Z",
};

describe("validateRegressionEvalCase", () => {
  it("accepts a fully valid eval case", () => {
    const result = validateRegressionEvalCase(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eval_id).toBe("eval_refund_exception_001");
      expect(result.value.expected_behavior).toHaveLength(3);
    }
  });

  it("accepts eval case with all optional fields", () => {
    const result = validateRegressionEvalCase({
      ...valid,
      required_evidence_usage: ["enterprise_exception_policy"],
      prohibited_patterns: ["blanket_denial"],
      privacy_constraints: ["no_raw_phone_numbers"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.required_evidence_usage).toEqual(["enterprise_exception_policy"]);
      expect(result.value.prohibited_patterns).toEqual(["blanket_denial"]);
      expect(result.value.privacy_constraints).toEqual(["no_raw_phone_numbers"]);
    }
  });

  it("omits optional fields when absent", () => {
    const result = validateRegressionEvalCase(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.required_evidence_usage).toBeUndefined();
      expect(result.value.prohibited_patterns).toBeUndefined();
      expect(result.value.privacy_constraints).toBeUndefined();
    }
  });

  it("rejects non-object input", () => {
    expect(validateRegressionEvalCase(null).ok).toBe(false);
    expect(validateRegressionEvalCase([]).ok).toBe(false);
  });

  it("rejects missing eval_id", () => {
    const { eval_id: _, ...rest } = valid;
    const result = validateRegressionEvalCase(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("eval_id"))).toBe(true);
  });

  it("rejects empty eval_id", () => {
    expect(validateRegressionEvalCase({ ...valid, eval_id: "" }).ok).toBe(false);
  });

  it("rejects missing source_finding_id", () => {
    const { source_finding_id: _, ...rest } = valid;
    expect(validateRegressionEvalCase(rest).ok).toBe(false);
  });

  it("rejects missing agent_id", () => {
    const { agent_id: _, ...rest } = valid;
    expect(validateRegressionEvalCase(rest).ok).toBe(false);
  });

  it("rejects missing input", () => {
    const { input: _, ...rest } = valid;
    const result = validateRegressionEvalCase(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("input"))).toBe(true);
  });

  it("rejects missing expected_behavior", () => {
    const { expected_behavior: _, ...rest } = valid;
    const result = validateRegressionEvalCase(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("expected_behavior"))).toBe(true);
  });

  it("rejects expected_behavior with non-string elements", () => {
    const result = validateRegressionEvalCase({ ...valid, expected_behavior: [1, 2, 3] });
    expect(result.ok).toBe(false);
  });

  it("accepts empty expected_behavior array", () => {
    expect(validateRegressionEvalCase({ ...valid, expected_behavior: [] }).ok).toBe(true);
  });

  it("rejects missing failure_mode_guarded", () => {
    const { failure_mode_guarded: _, ...rest } = valid;
    expect(validateRegressionEvalCase(rest).ok).toBe(false);
  });

  it("rejects missing created_at", () => {
    const { created_at: _, ...rest } = valid;
    const result = validateRegressionEvalCase(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("created_at"))).toBe(true);
  });

  it("rejects required_evidence_usage with non-string elements when provided", () => {
    const result = validateRegressionEvalCase({ ...valid, required_evidence_usage: [true] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("required_evidence_usage"))).toBe(true);
  });

  it("rejects prohibited_patterns with non-string elements when provided", () => {
    const result = validateRegressionEvalCase({ ...valid, prohibited_patterns: [42] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("prohibited_patterns"))).toBe(true);
  });

  it("rejects privacy_constraints with non-string elements when provided", () => {
    const result = validateRegressionEvalCase({ ...valid, privacy_constraints: [{}] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("privacy_constraints"))).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const result = validateRegressionEvalCase({ eval_id: "", input: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
