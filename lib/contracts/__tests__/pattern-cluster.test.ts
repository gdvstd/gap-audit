import { describe, it, expect } from "vitest";
import { validatePatternCluster } from "../pattern-cluster.js";

const valid = {
  cluster_id: "cluster_refund_exception_miss",
  agent_id: "support_agent",
  pattern_name: "evidence-output-contradiction:support",
  finding_count: 18,
  time_window: "2026-05-01T00:00:00Z/2026-05-28T00:00:00Z",
  dominant_lenses: ["Evidence-Output Audit"],
  severity: "high",
  trend: "increasing",
  recommended_action: "Add regression evals and update support-agent policy grounding",
  finding_ids: ["finding_001", "finding_002"],
};

describe("validatePatternCluster", () => {
  it("accepts a fully valid cluster", () => {
    const result = validatePatternCluster(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cluster_id).toBe("cluster_refund_exception_miss");
      expect(result.value.finding_count).toBe(18);
    }
  });

  it("rejects non-object input", () => {
    expect(validatePatternCluster(null).ok).toBe(false);
    expect(validatePatternCluster(42).ok).toBe(false);
  });

  it("rejects missing cluster_id", () => {
    const { cluster_id: _, ...rest } = valid;
    const result = validatePatternCluster(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("cluster_id"))).toBe(true);
  });

  it("rejects missing agent_id", () => {
    const { agent_id: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects missing pattern_name", () => {
    const { pattern_name: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects missing finding_count", () => {
    const { finding_count: _, ...rest } = valid;
    const result = validatePatternCluster(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("finding_count"))).toBe(true);
  });

  it("rejects non-number finding_count", () => {
    const result = validatePatternCluster({ ...valid, finding_count: "18" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("finding_count"))).toBe(true);
  });

  it("rejects finding_count below 0", () => {
    const result = validatePatternCluster({ ...valid, finding_count: -1 });
    expect(result.ok).toBe(false);
  });

  it("accepts finding_count of 0", () => {
    expect(validatePatternCluster({ ...valid, finding_count: 0 }).ok).toBe(true);
  });

  it("rejects missing time_window", () => {
    const { time_window: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects missing dominant_lenses", () => {
    const { dominant_lenses: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects dominant_lenses with non-string elements", () => {
    const result = validatePatternCluster({ ...valid, dominant_lenses: [1, 2] });
    expect(result.ok).toBe(false);
  });

  it("accepts empty dominant_lenses", () => {
    expect(validatePatternCluster({ ...valid, dominant_lenses: [] }).ok).toBe(true);
  });

  it("rejects invalid severity", () => {
    const result = validatePatternCluster({ ...valid, severity: "urgent" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
  });

  it("accepts all valid severity values", () => {
    for (const s of ["low", "medium", "high", "critical"]) {
      expect(validatePatternCluster({ ...valid, severity: s }).ok).toBe(true);
    }
  });

  it("rejects invalid trend", () => {
    const result = validatePatternCluster({ ...valid, trend: "rising" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("trend"))).toBe(true);
  });

  it("accepts all valid trend values", () => {
    for (const t of ["new", "stable", "increasing", "decreasing", "unknown"]) {
      expect(validatePatternCluster({ ...valid, trend: t }).ok).toBe(true);
    }
  });

  it("rejects missing recommended_action", () => {
    const { recommended_action: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects missing finding_ids", () => {
    const { finding_ids: _, ...rest } = valid;
    expect(validatePatternCluster(rest).ok).toBe(false);
  });

  it("rejects finding_ids with non-string elements", () => {
    const result = validatePatternCluster({ ...valid, finding_ids: [1, 2] });
    expect(result.ok).toBe(false);
  });

  it("accepts empty finding_ids", () => {
    expect(validatePatternCluster({ ...valid, finding_ids: [] }).ok).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const result = validatePatternCluster({ cluster_id: "", finding_count: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
