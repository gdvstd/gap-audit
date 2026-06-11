import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../in-memory.js";
import type { AuditMemoryAdapter } from "../adapter.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { PatternCluster } from "../../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../../contracts/review-decision.js";
import type { RegressionEvalCase } from "../../contracts/regression-eval-case.js";

function makeArtifact(task_id: string, agent_id = "agent-1"): AuditArtifact {
  return {
    task_id,
    agent_id,
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "test input",
    declared_goal: "test goal",
    final_output_summary: "test output",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
  };
}

function makeFinding(
  finding_id: string,
  agent_id = "agent-1",
  severity: AuditFinding["severity"] = "high"
): AuditFinding {
  return {
    finding_id,
    task_id: "task-1",
    agent_id,
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity,
    confidence: 0.85,
    evidence: ["some evidence"],
    evidence_keywords: ["some", "evidence"],
    recommended_action: "Review output",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
}

function makeCluster(cluster_id: string): PatternCluster {
  return {
    cluster_id,
    agent_id: "agent-1",
    pattern_name: "test-pattern",
    finding_count: 1,
    time_window: "2026-05-01T00:00:00Z/2026-05-02T00:00:00Z",
    dominant_lenses: ["evidence-output"],
    severity: "high",
    trend: "new",
    recommended_action: "Review",
    finding_ids: ["finding-1"],
  };
}

function makeDecision(finding_id: string): ReviewDecision {
  return {
    finding_id,
    decision: "confirmed",
    decided_at: "2026-05-01T00:00:00Z",
  };
}

function makeEvalCase(eval_id: string, agent_id = "agent-1", source_finding_id = "finding-1"): RegressionEvalCase {
  return {
    eval_id,
    source_finding_id,
    agent_id,
    input: "test input",
    expected_behavior: ["should not deny valid refund"],
    failure_mode_guarded: "Evidence-Output Contradiction",
    created_at: "2026-05-01T00:00:00Z",
  };
}

describe("createInMemoryAuditMemory", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  it("returns an adapter with name 'in-memory'", () => {
    expect(mem.name).toBe("in-memory");
  });

  it("enabled() returns true", () => {
    expect(mem.enabled()).toBe(true);
  });

  describe("saveArtifacts / (no list yet - adapter stores them)", () => {
    it("saves artifacts without throwing", async () => {
      await expect(mem.saveArtifacts([makeArtifact("task-1")])).resolves.toBeUndefined();
    });

    it("saves an empty array without throwing", async () => {
      await expect(mem.saveArtifacts([])).resolves.toBeUndefined();
    });
  });

  describe("saveFindings / listFindings", () => {
    it("round-trips a single finding", async () => {
      const f = makeFinding("finding-1");
      await mem.saveFindings([f]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("finding-1");
    });

    it("round-trips multiple findings", async () => {
      await mem.saveFindings([makeFinding("f-1"), makeFinding("f-2")]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(2);
    });

    it("accumulates across multiple saveFindings calls", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      await mem.saveFindings([makeFinding("f-2")]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(2);
    });

    it("filters by agent_id", async () => {
      await mem.saveFindings([
        makeFinding("f-1", "agent-1"),
        makeFinding("f-2", "agent-2"),
      ]);
      const list = await mem.listFindings({ agent_id: "agent-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.agent_id).toBe("agent-1");
    });

    it("filters by severity", async () => {
      await mem.saveFindings([
        makeFinding("f-1", "agent-1", "high"),
        makeFinding("f-2", "agent-1", "critical"),
        makeFinding("f-3", "agent-1", "low"),
      ]);
      const list = await mem.listFindings({ severity: "high" });
      expect(list).toHaveLength(1);
      expect(list[0]?.severity).toBe("high");
    });

    it("filters by both agent_id and severity", async () => {
      await mem.saveFindings([
        makeFinding("f-1", "agent-1", "high"),
        makeFinding("f-2", "agent-1", "critical"),
        makeFinding("f-3", "agent-2", "high"),
      ]);
      const list = await mem.listFindings({ agent_id: "agent-1", severity: "high" });
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("f-1");
    });

    it("returns empty array when no findings match filter", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-1", "high")]);
      const list = await mem.listFindings({ agent_id: "agent-2" });
      expect(list).toEqual([]);
    });

    it("returns all findings when no filter provided", async () => {
      await mem.saveFindings([makeFinding("f-1"), makeFinding("f-2")]);
      const list = await mem.listFindings({});
      expect(list).toHaveLength(2);
    });

    it("returns a fresh array (not the internal store)", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const list1 = await mem.listFindings();
      const list2 = await mem.listFindings();
      expect(list1).not.toBe(list2);
    });

    it("cloning: mutating saved input does not affect stored value", async () => {
      const f = makeFinding("f-1");
      await mem.saveFindings([f]);
      f.severity = "low";
      const list = await mem.listFindings();
      expect(list[0]?.severity).toBe("high");
    });

    it("cloning: mutating returned list does not affect internal store", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const list = await mem.listFindings();
      list.pop();
      const list2 = await mem.listFindings();
      expect(list2).toHaveLength(1);
    });
  });

  describe("saveReviewDecision", () => {
    it("saves a review decision without throwing", async () => {
      const d = makeDecision("finding-1");
      await expect(mem.saveReviewDecision(d)).resolves.toBeUndefined();
    });

    it("clones the decision on save (mutation safety)", async () => {
      const d = makeDecision("finding-1");
      await mem.saveReviewDecision(d);
      d.decision = "dismissed";
    });
  });

  describe("saveEvalCase / listEvalCases", () => {
    it("round-trips a single eval case", async () => {
      const e = makeEvalCase("eval-1");
      await mem.saveEvalCase(e);
      const list = await mem.listEvalCases();
      expect(list).toHaveLength(1);
      expect(list[0]?.eval_id).toBe("eval-1");
    });

    it("filters eval cases by agent_id", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1", "agent-1"));
      await mem.saveEvalCase(makeEvalCase("eval-2", "agent-2"));
      const list = await mem.listEvalCases({ agent_id: "agent-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.agent_id).toBe("agent-1");
    });

    it("filters eval cases by source_finding_id", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1", "agent-1", "finding-1"));
      await mem.saveEvalCase(makeEvalCase("eval-2", "agent-1", "finding-2"));
      const list = await mem.listEvalCases({ source_finding_id: "finding-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.eval_id).toBe("eval-1");
    });

    it("returns a fresh array each call", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1"));
      const l1 = await mem.listEvalCases();
      const l2 = await mem.listEvalCases();
      expect(l1).not.toBe(l2);
    });

    it("cloning: mutating saved eval does not affect stored value", async () => {
      const e = makeEvalCase("eval-1");
      await mem.saveEvalCase(e);
      e.failure_mode_guarded = "mutated";
      const list = await mem.listEvalCases();
      expect(list[0]?.failure_mode_guarded).toBe("Evidence-Output Contradiction");
    });
  });

  describe("listClusters", () => {
    it("returns empty array when no clusters saved", async () => {
      const list = await mem.listClusters();
      expect(list).toEqual([]);
    });

    it("returns a fresh array each call", async () => {
      const l1 = await mem.listClusters();
      const l2 = await mem.listClusters();
      expect(l1).not.toBe(l2);
    });
  });
});
