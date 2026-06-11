import { describe, it, expect } from "vitest";
import { rankReviewQueue } from "../queue.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { PatternCluster } from "../../contracts/pattern-cluster.js";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    finding_id: "f-1",
    task_id: "task-1",
    agent_id: "agent-1",
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity: "high",
    confidence: 0.85,
    evidence: ["evidence"],
    evidence_keywords: ["evidence"],
    recommended_action: "Review",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeCluster(cluster_id: string, finding_count: number): PatternCluster {
  return {
    cluster_id,
    agent_id: "agent-1",
    pattern_name: "test:unknown",
    finding_count,
    time_window: "2026-05-01T00:00:00Z/2026-05-02T00:00:00Z",
    dominant_lenses: ["evidence-output"],
    severity: "high",
    trend: "new",
    recommended_action: "Review",
    finding_ids: Array.from({ length: finding_count }, (_, i) => `f-${i}`),
  };
}

describe("rankReviewQueue", () => {
  it("returns empty array for empty input", () => {
    expect(rankReviewQueue({ findings: [], clusters: [] })).toEqual([]);
  });

  it("sorts by severity desc: critical before high before medium before low", () => {
    const findings = [
      makeFinding({ finding_id: "f-low", severity: "low", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
      makeFinding({ finding_id: "f-critical", severity: "critical", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
      makeFinding({ finding_id: "f-medium", severity: "medium", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
      makeFinding({ finding_id: "f-high", severity: "high", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
    ];
    const result = rankReviewQueue({ findings, clusters: [] });
    const ids = result.map((f) => f.finding_id);
    expect(ids[0]).toBe("f-critical");
    expect(ids[1]).toBe("f-high");
    expect(ids[2]).toBe("f-medium");
    expect(ids[3]).toBe("f-low");
  });

  it("sorts by confidence desc when severity is equal", () => {
    const findings = [
      makeFinding({ finding_id: "f-low-conf", severity: "high", confidence: 0.6, updated_at: "2026-05-02T00:00:00Z" }),
      makeFinding({ finding_id: "f-high-conf", severity: "high", confidence: 0.95, updated_at: "2026-05-02T00:00:00Z" }),
    ];
    const result = rankReviewQueue({ findings, clusters: [] });
    expect(result[0]?.finding_id).toBe("f-high-conf");
    expect(result[1]?.finding_id).toBe("f-low-conf");
  });

  it("sorts by cluster recurrence desc when severity and confidence are equal", () => {
    const findings = [
      makeFinding({ finding_id: "f-singleton", severity: "high", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
      makeFinding({ finding_id: "f-clustered", severity: "high", confidence: 0.9, cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" }),
    ];
    const clusters = [makeCluster("c-1", 9)];
    const result = rankReviewQueue({ findings, clusters });
    expect(result[0]?.finding_id).toBe("f-clustered");
    expect(result[1]?.finding_id).toBe("f-singleton");
  });

  it("tie-breaks by updated_at desc", () => {
    const findings = [
      makeFinding({ finding_id: "f-older", severity: "high", confidence: 0.9, updated_at: "2026-05-01T00:00:00Z" }),
      makeFinding({ finding_id: "f-newer", severity: "high", confidence: 0.9, updated_at: "2026-05-02T00:00:00Z" }),
    ];
    const result = rankReviewQueue({ findings, clusters: [] });
    expect(result[0]?.finding_id).toBe("f-newer");
    expect(result[1]?.finding_id).toBe("f-older");
  });

  it("default filter hides low severity + low confidence + unclustered findings", () => {
    const findings = [
      makeFinding({ finding_id: "f-hidden", severity: "low", confidence: 0.5 }),
      makeFinding({ finding_id: "f-visible", severity: "high", confidence: 0.85 }),
    ];
    const result = rankReviewQueue({ findings, clusters: [] });
    expect(result.map((f) => f.finding_id)).not.toContain("f-hidden");
    expect(result.map((f) => f.finding_id)).toContain("f-visible");
  });

  it("includeAll: true disables the default filter", () => {
    const findings = [
      makeFinding({ finding_id: "f-hidden", severity: "low", confidence: 0.5 }),
    ];
    const result = rankReviewQueue({ findings, clusters: [], includeAll: true });
    expect(result.map((f) => f.finding_id)).toContain("f-hidden");
  });

  it("low severity with high confidence is NOT filtered", () => {
    const findings = [
      makeFinding({ finding_id: "f-low-high-conf", severity: "low", confidence: 0.8 }),
    ];
    const result = rankReviewQueue({ findings, clusters: [] });
    expect(result.map((f) => f.finding_id)).toContain("f-low-high-conf");
  });

  it("low severity + low confidence but clustered is NOT filtered", () => {
    const findings = [
      makeFinding({ finding_id: "f-clustered-low", severity: "low", confidence: 0.5, cluster_id: "c-1" }),
    ];
    const clusters = [makeCluster("c-1", 3)];
    const result = rankReviewQueue({ findings, clusters });
    expect(result.map((f) => f.finding_id)).toContain("f-clustered-low");
  });

  it("unclustered findings use recurrence 0", () => {
    const findings = [
      makeFinding({ finding_id: "f-unclustered", severity: "high", confidence: 0.85 }),
      makeFinding({ finding_id: "f-clustered", severity: "high", confidence: 0.85, cluster_id: "c-1" }),
    ];
    const clusters = [makeCluster("c-1", 5)];
    const result = rankReviewQueue({ findings, clusters });
    expect(result[0]?.finding_id).toBe("f-clustered");
  });

  it("does not mutate input arrays", () => {
    const findings = [
      makeFinding({ finding_id: "f-1", severity: "high" }),
      makeFinding({ finding_id: "f-2", severity: "critical" }),
    ];
    const originalOrder = findings.map((f) => f.finding_id);
    rankReviewQueue({ findings, clusters: [] });
    expect(findings.map((f) => f.finding_id)).toEqual(originalOrder);
  });
});
