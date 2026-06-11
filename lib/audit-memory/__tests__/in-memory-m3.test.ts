import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../in-memory.js";
import type { AuditMemoryAdapter } from "../adapter.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { PatternCluster } from "../../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../../contracts/review-decision.js";

function makeFinding(
  finding_id: string,
  agent_id = "agent-1",
  overrides: Partial<AuditFinding> = {}
): AuditFinding {
  return {
    finding_id,
    task_id: "task-1",
    agent_id,
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity: "high",
    confidence: 0.85,
    evidence: ["some evidence"],
    evidence_keywords: ["some", "evidence"],
    recommended_action: "Review output",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeCluster(cluster_id: string, overrides: Partial<PatternCluster> = {}): PatternCluster {
  return {
    cluster_id,
    agent_id: "agent-1",
    pattern_name: "test-pattern:unknown",
    finding_count: 1,
    time_window: "2026-05-01T00:00:00Z/2026-05-02T00:00:00Z",
    dominant_lenses: ["evidence-output"],
    severity: "high",
    trend: "new",
    recommended_action: "Review",
    finding_ids: ["finding-1"],
    ...overrides,
  };
}

function makeDecision(finding_id: string, decision: ReviewDecision["decision"] = "confirmed"): ReviewDecision {
  return {
    finding_id,
    decision,
    decided_at: "2026-05-01T00:00:00Z",
  };
}

describe("createInMemoryAuditMemory — M3 additions", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  // ── saveFindings upsert behavior ──────────────────────────────────────────

  describe("saveFindings — upsert semantics", () => {
    it("re-saving with same finding_id overwrites the prior entry", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-1", { severity: "high" })]);
      await mem.saveFindings([makeFinding("f-1", "agent-1", { severity: "critical" })]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(1);
      expect(list[0]?.severity).toBe("critical");
    });

    it("two separate finds with different ids both persist", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      await mem.saveFindings([makeFinding("f-2")]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(2);
    });
  });

  // ── listReviewDecisions ───────────────────────────────────────────────────

  describe("listReviewDecisions", () => {
    it("returns empty array when no decisions saved", async () => {
      const list = await mem.listReviewDecisions();
      expect(list).toEqual([]);
    });

    it("returns all decisions when no filter provided", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      await mem.saveReviewDecision(makeDecision("f-2"));
      const list = await mem.listReviewDecisions();
      expect(list).toHaveLength(2);
    });

    it("filters by finding_id", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      await mem.saveReviewDecision(makeDecision("f-2"));
      const list = await mem.listReviewDecisions({ finding_id: "f-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("f-1");
    });

    it("returns empty array when finding_id filter matches nothing", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      const list = await mem.listReviewDecisions({ finding_id: "f-99" });
      expect(list).toEqual([]);
    });

    it("returns a fresh array each call (not internal store)", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      const l1 = await mem.listReviewDecisions();
      const l2 = await mem.listReviewDecisions();
      expect(l1).not.toBe(l2);
    });

    it("cloning: mutating returned decision does not affect internal store", async () => {
      await mem.saveReviewDecision(makeDecision("f-1", "confirmed"));
      const list = await mem.listReviewDecisions();
      const first = list[0];
      if (first) {
        (first as { decision: string }).decision = "dismissed";
      }
      const list2 = await mem.listReviewDecisions();
      expect(list2[0]?.decision).toBe("confirmed");
    });

    it("cloning: mutating saved decision does not affect stored value", async () => {
      const d = makeDecision("f-1", "confirmed");
      await mem.saveReviewDecision(d);
      (d as { decision: string }).decision = "dismissed";
      const list = await mem.listReviewDecisions();
      expect(list[0]?.decision).toBe("confirmed");
    });
  });

  // ── saveClusters ──────────────────────────────────────────────────────────

  describe("saveClusters", () => {
    it("saves clusters retrievable via listClusters", async () => {
      await mem.saveClusters([makeCluster("c-1")]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(1);
      expect(list[0]?.cluster_id).toBe("c-1");
    });

    it("upserts by cluster_id (overwrites prior entry)", async () => {
      await mem.saveClusters([makeCluster("c-1", { finding_count: 1 })]);
      await mem.saveClusters([makeCluster("c-1", { finding_count: 5 })]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_count).toBe(5);
    });

    it("accumulates different cluster_ids", async () => {
      await mem.saveClusters([makeCluster("c-1")]);
      await mem.saveClusters([makeCluster("c-2")]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(2);
    });

    it("saves empty array without error", async () => {
      await expect(mem.saveClusters([])).resolves.toBeUndefined();
    });

    it("cloning: mutating saved cluster does not affect stored value", async () => {
      const c = makeCluster("c-1", { finding_count: 1 });
      await mem.saveClusters([c]);
      (c as { finding_count: number }).finding_count = 99;
      const list = await mem.listClusters();
      expect(list[0]?.finding_count).toBe(1);
    });

    it("cloning: mutating returned cluster does not affect internal store", async () => {
      await mem.saveClusters([makeCluster("c-1", { finding_count: 1 })]);
      const list = await mem.listClusters();
      const first = list[0];
      if (first) {
        (first as { finding_count: number }).finding_count = 999;
      }
      const list2 = await mem.listClusters();
      expect(list2[0]?.finding_count).toBe(1);
    });
  });

  // ── updateFinding ─────────────────────────────────────────────────────────

  describe("updateFinding", () => {
    it("updates cluster_id on an existing finding", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const updated = await mem.updateFinding("f-1", { cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" });
      expect(updated.cluster_id).toBe("c-1");
      expect(updated.updated_at).toBe("2026-05-02T00:00:00Z");
    });

    it("returns merged copy with all original fields preserved", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-x", { severity: "critical" })]);
      const updated = await mem.updateFinding("f-1", { cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" });
      expect(updated.finding_id).toBe("f-1");
      expect(updated.agent_id).toBe("agent-x");
      expect(updated.severity).toBe("critical");
    });

    it("persists the update so subsequent listFindings reflects it", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      await mem.updateFinding("f-1", { cluster_id: "c-99", updated_at: "2026-05-03T00:00:00Z" });
      const list = await mem.listFindings();
      const f = list.find((x) => x.finding_id === "f-1");
      expect(f?.cluster_id).toBe("c-99");
    });

    it("throws when finding_id not found", async () => {
      await expect(mem.updateFinding("nonexistent", { updated_at: "2026-05-01T00:00:00Z" })).rejects.toThrow();
    });

    it("does not mutate the input partial", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const partial = { cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" };
      await mem.updateFinding("f-1", partial);
      expect(partial.cluster_id).toBe("c-1");
    });

    it("update is non-destructive (original fields not lost)", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const updated = await mem.updateFinding("f-1", { converted_to_eval: true, updated_at: "2026-05-02T00:00:00Z" });
      expect(updated.lens).toBe("evidence-output");
      expect(updated.evidence_keywords).toEqual(["some", "evidence"]);
    });

    it("returned value is a clone (mutation does not affect stored state)", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const updated = await mem.updateFinding("f-1", { cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" });
      (updated as { cluster_id: string }).cluster_id = "mutated";
      const list = await mem.listFindings();
      const f = list.find((x) => x.finding_id === "f-1");
      expect(f?.cluster_id).toBe("c-1");
    });
  });
});
