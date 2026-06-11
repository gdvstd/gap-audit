/**
 * MongoDB audit memory adapter tests.
 * Uses a fake in-memory collection double — no real database.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMongoAuditMemory, toDoc, fromDoc } from "../mongodb.js";
import type { AuditMemoryAdapter } from "../adapter.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { AgentProfile } from "../../contracts/agent-profile.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { PatternCluster } from "../../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../../contracts/review-decision.js";
import type { RegressionEvalCase } from "../../contracts/regression-eval-case.js";

// ── Fake collection double ─────────────────────────────────────────────────

type FakeDoc = Record<string, unknown>;

function makeFakeCollection(idField: string = "_no_default") {
  const store = new Map<string, FakeDoc>();

  return {
    _store: store,
    async findOne(filter: Record<string, unknown>): Promise<FakeDoc | null> {
      for (const doc of store.values()) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          return { ...doc };
        }
      }
      return null;
    },
    async find(filter: Record<string, unknown>): Promise<{ toArray(): Promise<FakeDoc[]> }> {
      const results: FakeDoc[] = [];
      for (const doc of store.values()) {
        const matches = Object.entries(filter).every(([k, v]) => {
          if (v === undefined) return true;
          return doc[k] === v;
        });
        if (matches) results.push({ ...doc });
      }
      return {
        toArray: async () => results.map((d) => ({ ...d })),
      };
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<void> {
      const upsert = options["upsert"] === true;
      const setDoc = (update["$set"] ?? {}) as FakeDoc;

      let foundKey: string | null = null;
      for (const [key, doc] of store.entries()) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          foundKey = key;
          break;
        }
      }

      if (foundKey !== null) {
        const existing = store.get(foundKey) ?? {};
        store.set(foundKey, { ...existing, ...setDoc });
      } else if (upsert) {
        const keyField = idField;
        const keyValue = (setDoc[keyField] as string | undefined) ?? String(store.size + 1);
        store.set(keyValue, { ...setDoc });
      }
    },
    async deleteOne(filter: Record<string, unknown>): Promise<void> {
      for (const [key, doc] of store.entries()) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          store.delete(key);
          break;
        }
      }
    },
  };
}

type FakeCollections = {
  agent_profiles: ReturnType<typeof makeFakeCollection>;
  artifacts: ReturnType<typeof makeFakeCollection>;
  findings: ReturnType<typeof makeFakeCollection>;
  review_decisions: ReturnType<typeof makeFakeCollection>;
  eval_cases: ReturnType<typeof makeFakeCollection>;
  clusters: ReturnType<typeof makeFakeCollection>;
};

function makeFakeDb(): FakeCollections & {
  collection(name: string): ReturnType<typeof makeFakeCollection>;
} {
  const cols: FakeCollections = {
    agent_profiles: makeFakeCollection("agent_id"),
    artifacts: makeFakeCollection("task_id"),
    findings: makeFakeCollection("finding_id"),
    review_decisions: makeFakeCollection("finding_id"),
    eval_cases: makeFakeCollection("eval_id"),
    clusters: makeFakeCollection("cluster_id"),
  };
  return {
    ...cols,
    collection(name: string): ReturnType<typeof makeFakeCollection> {
      if (name === "agent_profiles") return cols.agent_profiles;
      if (name === "artifacts") return cols.artifacts;
      if (name === "findings") return cols.findings;
      if (name === "review_decisions") return cols.review_decisions;
      if (name === "eval_cases") return cols.eval_cases;
      if (name === "clusters") return cols.clusters;
      throw new Error(`Unknown collection: ${name}`);
    },
  };
}

// ── Test data factories ────────────────────────────────────────────────────

function makeProfile(agent_id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    agent_id,
    agent_name: `Agent ${agent_id}`,
    role: "support",
    allowed_actions: ["lookup", "respond"],
    restricted_actions: ["delete"],
    quality_principles: ["be accurate"],
    ...overrides,
  };
}

function makeArtifact(task_id: string, agent_id = "agent-1", overrides: Partial<AuditArtifact> = {}): AuditArtifact {
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
    ...overrides,
  };
}

function makeFinding(
  finding_id: string,
  agent_id = "agent-1",
  severity: AuditFinding["severity"] = "high",
  overrides: Partial<AuditFinding> = {}
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

function makeEvalCase(
  eval_id: string,
  agent_id = "agent-1",
  source_finding_id = "finding-1"
): RegressionEvalCase {
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createMongoAuditMemory", () => {
  let db: ReturnType<typeof makeFakeDb>;
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    db = makeFakeDb();
    mem = createMongoAuditMemory({ getDb: () => Promise.resolve(db as unknown as import("mongodb").Db) });
  });

  it("has name 'mongodb'", () => {
    expect(mem.name).toBe("mongodb");
  });

  it("enabled() returns false when MONGODB_ENABLED is unset", () => {
    delete process.env["MONGODB_ENABLED"];
    expect(mem.enabled()).toBe(false);
  });

  it("enabled() returns true when MONGODB_ENABLED=true and MONGODB_URI is set", () => {
    process.env["MONGODB_ENABLED"] = "true";
    process.env["MONGODB_URI"] = "mongodb://localhost:27017";
    expect(mem.enabled()).toBe(true);
    delete process.env["MONGODB_ENABLED"];
    delete process.env["MONGODB_URI"];
  });

  it("enabled() returns false when MONGODB_ENABLED=true but MONGODB_URI is missing", () => {
    process.env["MONGODB_ENABLED"] = "true";
    delete process.env["MONGODB_URI"];
    expect(mem.enabled()).toBe(false);
    delete process.env["MONGODB_ENABLED"];
  });

  // ── saveAgentProfiles / getAgentProfile ──────────────────────────────────

  describe("saveAgentProfiles / getAgentProfile", () => {
    it("round-trips a single profile", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1")]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result).not.toBeNull();
      expect(result?.agent_id).toBe("agent-1");
    });

    it("returns null when agent_id not found", async () => {
      const result = await mem.getAgentProfile("nonexistent");
      expect(result).toBeNull();
    });

    it("upserts by agent_id (second save overwrites first)", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "support" })]);
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "devops" })]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result?.role).toBe("devops");
    });

    it("saves empty array without throwing", async () => {
      await expect(mem.saveAgentProfiles([])).resolves.toBeUndefined();
    });

    it("does not return _id field", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1")]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result).not.toBeNull();
      expect(Object.keys(result as object)).not.toContain("_id");
    });

    it("cloning: mutating saved profile does not affect stored value", async () => {
      const p = makeProfile("agent-1", { role: "support" });
      await mem.saveAgentProfiles([p]);
      (p as { role: string }).role = "mutated";
      const result = await mem.getAgentProfile("agent-1");
      expect(result?.role).toBe("support");
    });

    it("cloning: mutating returned profile does not affect stored value", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "support" })]);
      const r1 = await mem.getAgentProfile("agent-1");
      if (r1) (r1 as { role: string }).role = "mutated";
      const r2 = await mem.getAgentProfile("agent-1");
      expect(r2?.role).toBe("support");
    });
  });

  // ── saveArtifacts / getArtifact / listArtifacts ──────────────────────────

  describe("saveArtifacts / getArtifact / listArtifacts", () => {
    it("round-trips a single artifact via getArtifact", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const result = await mem.getArtifact("task-1");
      expect(result?.task_id).toBe("task-1");
    });

    it("getArtifact returns null when not found", async () => {
      const result = await mem.getArtifact("nonexistent");
      expect(result).toBeNull();
    });

    it("listArtifacts returns all artifacts", async () => {
      await mem.saveArtifacts([makeArtifact("task-1"), makeArtifact("task-2")]);
      const list = await mem.listArtifacts();
      expect(list).toHaveLength(2);
    });

    it("listArtifacts filters by agent_id", async () => {
      await mem.saveArtifacts([
        makeArtifact("task-1", "agent-1"),
        makeArtifact("task-2", "agent-2"),
      ]);
      const list = await mem.listArtifacts({ agent_id: "agent-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.agent_id).toBe("agent-1");
    });

    it("listArtifacts returns empty array when no artifacts saved", async () => {
      const list = await mem.listArtifacts();
      expect(list).toEqual([]);
    });

    it("upserts by task_id", async () => {
      await mem.saveArtifacts([makeArtifact("task-1", "agent-1")]);
      await mem.saveArtifacts([makeArtifact("task-1", "agent-2")]);
      const result = await mem.getArtifact("task-1");
      expect(result?.agent_id).toBe("agent-2");
    });

    it("does not return _id field", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const result = await mem.getArtifact("task-1");
      expect(result).not.toBeNull();
      expect(Object.keys(result as object)).not.toContain("_id");
    });

    it("cloning: mutating returned artifact does not affect stored value", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const r1 = await mem.getArtifact("task-1");
      if (r1) (r1 as { declared_goal: string }).declared_goal = "mutated";
      const r2 = await mem.getArtifact("task-1");
      expect(r2?.declared_goal).toBe("test goal");
    });
  });

  // ── saveFindings / listFindings ──────────────────────────────────────────

  describe("saveFindings / listFindings", () => {
    it("round-trips a single finding", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("f-1");
    });

    it("filters by agent_id", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-1"), makeFinding("f-2", "agent-2")]);
      const list = await mem.listFindings({ agent_id: "agent-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.agent_id).toBe("agent-1");
    });

    it("filters by severity", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-1", "high"), makeFinding("f-2", "agent-1", "critical")]);
      const list = await mem.listFindings({ severity: "high" });
      expect(list).toHaveLength(1);
      expect(list[0]?.severity).toBe("high");
    });

    it("upserts by finding_id", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-1", "high")]);
      await mem.saveFindings([makeFinding("f-1", "agent-1", "critical")]);
      const list = await mem.listFindings();
      expect(list).toHaveLength(1);
      expect(list[0]?.severity).toBe("critical");
    });

    it("returns empty array when no findings", async () => {
      const list = await mem.listFindings();
      expect(list).toEqual([]);
    });

    it("does not return _id field", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const list = await mem.listFindings();
      expect(list[0]).toBeDefined();
      expect(Object.keys(list[0] as object)).not.toContain("_id");
    });

    it("cloning: mutating saved finding does not affect stored value", async () => {
      const f = makeFinding("f-1");
      await mem.saveFindings([f]);
      f.severity = "low";
      const list = await mem.listFindings();
      expect(list[0]?.severity).toBe("high");
    });

    it("cloning: mutating returned finding does not affect stored value", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const list = await mem.listFindings();
      if (list[0]) (list[0] as { severity: string }).severity = "low";
      const list2 = await mem.listFindings();
      expect(list2[0]?.severity).toBe("high");
    });
  });

  // ── saveReviewDecision / listReviewDecisions ─────────────────────────────

  describe("saveReviewDecision / listReviewDecisions", () => {
    it("round-trips a single decision", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      const list = await mem.listReviewDecisions();
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("f-1");
    });

    it("filters by finding_id", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      await mem.saveReviewDecision(makeDecision("f-2"));
      const list = await mem.listReviewDecisions({ finding_id: "f-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_id).toBe("f-1");
    });

    it("upserts by finding_id (second save overwrites first)", async () => {
      await mem.saveReviewDecision(makeDecision("f-1", "confirmed"));
      await mem.saveReviewDecision(makeDecision("f-1", "dismissed"));
      const list = await mem.listReviewDecisions();
      expect(list).toHaveLength(1);
      expect(list[0]?.decision).toBe("dismissed");
    });

    it("returns empty array when no decisions", async () => {
      const list = await mem.listReviewDecisions();
      expect(list).toEqual([]);
    });

    it("does not return _id field", async () => {
      await mem.saveReviewDecision(makeDecision("f-1"));
      const list = await mem.listReviewDecisions();
      expect(list[0]).toBeDefined();
      expect(Object.keys(list[0] as object)).not.toContain("_id");
    });
  });

  // ── saveEvalCase / listEvalCases ─────────────────────────────────────────

  describe("saveEvalCase / listEvalCases", () => {
    it("round-trips a single eval case", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1"));
      const list = await mem.listEvalCases();
      expect(list).toHaveLength(1);
      expect(list[0]?.eval_id).toBe("eval-1");
    });

    it("filters by agent_id", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1", "agent-1"));
      await mem.saveEvalCase(makeEvalCase("eval-2", "agent-2"));
      const list = await mem.listEvalCases({ agent_id: "agent-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.agent_id).toBe("agent-1");
    });

    it("filters by source_finding_id", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1", "agent-1", "finding-1"));
      await mem.saveEvalCase(makeEvalCase("eval-2", "agent-1", "finding-2"));
      const list = await mem.listEvalCases({ source_finding_id: "finding-1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.eval_id).toBe("eval-1");
    });

    it("upserts by eval_id", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1", "agent-1"));
      await mem.saveEvalCase({ ...makeEvalCase("eval-1", "agent-1"), input: "updated input" });
      const list = await mem.listEvalCases();
      expect(list).toHaveLength(1);
      expect(list[0]?.input).toBe("updated input");
    });

    it("returns empty array when no eval cases", async () => {
      const list = await mem.listEvalCases();
      expect(list).toEqual([]);
    });

    it("does not return _id field", async () => {
      await mem.saveEvalCase(makeEvalCase("eval-1"));
      const list = await mem.listEvalCases();
      expect(list[0]).toBeDefined();
      expect(Object.keys(list[0] as object)).not.toContain("_id");
    });
  });

  // ── saveClusters / listClusters ──────────────────────────────────────────

  describe("saveClusters / listClusters", () => {
    it("round-trips a single cluster", async () => {
      await mem.saveClusters([makeCluster("c-1")]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(1);
      expect(list[0]?.cluster_id).toBe("c-1");
    });

    it("upserts by cluster_id", async () => {
      await mem.saveClusters([makeCluster("c-1", { finding_count: 1 })]);
      await mem.saveClusters([makeCluster("c-1", { finding_count: 5 })]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(1);
      expect(list[0]?.finding_count).toBe(5);
    });

    it("accumulates different cluster_ids", async () => {
      await mem.saveClusters([makeCluster("c-1"), makeCluster("c-2")]);
      const list = await mem.listClusters();
      expect(list).toHaveLength(2);
    });

    it("returns empty array when no clusters", async () => {
      const list = await mem.listClusters();
      expect(list).toEqual([]);
    });

    it("saves empty array without error", async () => {
      await expect(mem.saveClusters([])).resolves.toBeUndefined();
    });

    it("does not return _id field", async () => {
      await mem.saveClusters([makeCluster("c-1")]);
      const list = await mem.listClusters();
      expect(list[0]).toBeDefined();
      expect(Object.keys(list[0] as object)).not.toContain("_id");
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

    it("preserves all original fields after update", async () => {
      await mem.saveFindings([makeFinding("f-1", "agent-x", "critical")]);
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
      await expect(
        mem.updateFinding("nonexistent", { updated_at: "2026-05-01T00:00:00Z" })
      ).rejects.toThrow();
    });

    it("returns value that does not contain _id", async () => {
      await mem.saveFindings([makeFinding("f-1")]);
      const updated = await mem.updateFinding("f-1", { cluster_id: "c-1", updated_at: "2026-05-02T00:00:00Z" });
      expect(Object.keys(updated)).not.toContain("_id");
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

// ── toDoc / fromDoc pure-function tests ───────────────────────────────────

describe("toDoc / fromDoc — pure mapping functions", () => {
  it("toDoc strips no fields by default", () => {
    const finding = makeFinding("f-1");
    const doc = toDoc(finding);
    expect(doc["finding_id"]).toBe("f-1");
    expect(doc["agent_id"]).toBe("agent-1");
  });

  it("fromDoc strips _id field from result", () => {
    const raw = {
      _id: "mongo-object-id",
      finding_id: "f-1",
      task_id: "task-1",
      agent_id: "agent-1",
      lens: "evidence-output",
      failure_mode: "test",
      severity: "high",
      confidence: 0.9,
      evidence: ["ev1"],
      evidence_keywords: ["ev"],
      recommended_action: "review",
      human_review_required: true,
      converted_to_eval: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const result = fromDoc<AuditFinding>(raw);
    expect(Object.keys(result)).not.toContain("_id");
    expect(result.finding_id).toBe("f-1");
  });

  it("fromDoc is a deep clone (mutating source does not affect result)", () => {
    const raw: Record<string, unknown> = {
      finding_id: "f-1",
      task_id: "task-1",
      agent_id: "agent-1",
      lens: "evidence-output",
      failure_mode: "test",
      severity: "high",
      confidence: 0.9,
      evidence: ["ev1"],
      evidence_keywords: ["ev"],
      recommended_action: "review",
      human_review_required: true,
      converted_to_eval: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const result = fromDoc<AuditFinding>(raw);
    (raw["evidence"] as string[]).push("mutation");
    expect(result.evidence).toHaveLength(1);
  });

  it("toDoc/fromDoc round-trip preserves all domain fields", () => {
    const artifact = makeArtifact("task-1", "agent-1");
    const doc = toDoc(artifact);
    const roundTrip = fromDoc<AuditArtifact>(doc);
    expect(roundTrip.task_id).toBe("task-1");
    expect(roundTrip.agent_id).toBe("agent-1");
    expect(roundTrip.tool_facts).toEqual([]);
    expect(roundTrip.guardrail_events).toEqual([]);
  });

  it("toDoc/fromDoc round-trip preserves optional cluster_id when present", () => {
    const finding = makeFinding("f-1", "agent-1", "high", { cluster_id: "c-1" });
    const doc = toDoc(finding);
    const roundTrip = fromDoc<AuditFinding>(doc);
    expect(roundTrip.cluster_id).toBe("c-1");
  });

  it("toDoc/fromDoc round-trip: missing optional cluster_id stays absent", () => {
    const finding = makeFinding("f-1");
    const doc = toDoc(finding);
    const roundTrip = fromDoc<AuditFinding>(doc);
    expect("cluster_id" in roundTrip).toBe(false);
  });

  it("toDoc returns a plain object (not the same reference)", () => {
    const finding = makeFinding("f-1");
    const doc = toDoc(finding);
    expect(doc).not.toBe(finding);
  });
});
