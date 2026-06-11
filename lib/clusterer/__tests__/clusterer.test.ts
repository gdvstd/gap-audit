import { describe, it, expect, afterEach } from "vitest";
import { runClusterer } from "../clusterer.js";
import { createInMemoryAuditMemory } from "../../audit-memory/index.js";
import { __test__setClusterIdFactory } from "../cluster-id.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";

afterEach(() => {
  __test__setClusterIdFactory(null);
});

function makeFinding(
  finding_id: string,
  overrides: Partial<AuditFinding> = {}
): AuditFinding {
  return {
    finding_id,
    task_id: `task-${finding_id}`,
    agent_id: "agent-1",
    lens: "false-success",
    failure_mode: "False Success",
    severity: "high",
    confidence: 0.9,
    evidence: ["resolved but failed check"],
    evidence_keywords: ["resolved", "failed", "check"],
    recommended_action: "Verify completion",
    human_review_required: true,
    converted_to_eval: false,
    task_type: "incident-response",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

describe("runClusterer", () => {
  it("returns 0 clusters and 0 updated findings for empty memory", async () => {
    const memory = createInMemoryAuditMemory();
    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(0);
    expect(result.updated_finding_count).toBe(0);
  });

  it("single finding produces 1 cluster with trend 'new'", async () => {
    __test__setClusterIdFactory(() => "c-1");
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(1);

    const clusters = await memory.listClusters();
    expect(clusters[0]?.trend).toBe("new");
    expect(clusters[0]?.finding_count).toBe(1);
  });

  it("two findings with high Jaccard similarity are in 1 cluster", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { evidence_keywords: ["resolved", "failed", "check", "metric"] }),
      makeFinding("f-2", { evidence_keywords: ["resolved", "failed", "check", "recovery"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(1);
    const clusters = await memory.listClusters();
    expect(clusters[0]?.finding_count).toBe(2);
  });

  it("two findings with low Jaccard similarity produce 2 clusters", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { evidence_keywords: ["alpha", "beta", "gamma", "delta"] }),
      makeFinding("f-2", { evidence_keywords: ["zeta", "eta", "theta", "iota"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });

  it("two findings with different agent_id stay in separate clusters even with same keywords", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { agent_id: "agent-a", evidence_keywords: ["resolved", "failed", "check"] }),
      makeFinding("f-2", { agent_id: "agent-b", evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });

  it("two findings with different lens stay in separate clusters", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { lens: "false-success", evidence_keywords: ["resolved", "failed", "check"] }),
      makeFinding("f-2", { lens: "evidence-output", evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });

  it("two findings with different failure_mode stay in separate clusters", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { failure_mode: "False Success", evidence_keywords: ["resolved", "failed", "check"] }),
      makeFinding("f-2", { failure_mode: "Unsafe Retention", evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });

  it("two findings with different task_type stay in separate clusters", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { task_type: "incident-response", evidence_keywords: ["resolved", "failed", "check"] }),
      makeFinding("f-2", { task_type: "customer-inquiry", evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });

  it("findings without task_type use 'unknown' and can be grouped together", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();

    const f1 = makeFinding("f-1", { evidence_keywords: ["resolved", "failed", "check"] });
    const f2 = makeFinding("f-2", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" });
    // Remove task_type to simulate absent task_type — use spread to omit it
    const { task_type: _1, ...f1WithoutType } = f1;
    const { task_type: _2, ...f2WithoutType } = f2;

    await memory.saveFindings([f1WithoutType as AuditFinding, f2WithoutType as AuditFinding]);

    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(1);
  });

  it("cluster_id is reused across re-runs when group matches", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory });

    const after1 = await memory.listClusters();
    const firstId = after1[0]?.cluster_id;
    expect(firstId).toBe("c-1");

    await memory.saveFindings([
      makeFinding("f-2", {
        evidence_keywords: ["resolved", "failed", "check"],
        created_at: "2026-05-02T00:00:00Z",
      }),
    ]);
    await runClusterer({ memory });

    const after2 = await memory.listClusters();
    expect(after2[0]?.cluster_id).toBe("c-1");
  });

  it("trend is 'increasing' when prior cluster gains findings", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory });

    await memory.saveFindings([
      makeFinding("f-2", {
        evidence_keywords: ["resolved", "failed", "check"],
        created_at: "2026-05-02T00:00:00Z",
      }),
    ]);
    const result2 = await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.trend).toBe("increasing");
    expect(result2.cluster_count).toBe(1);
  });

  it("trend is 'stable' when prior cluster is unchanged", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory });
    await runClusterer({ memory });

    const clusters = await memory.listClusters();
    expect(clusters[0]?.trend).toBe("stable");
  });

  it("severity in cluster is max of member severities", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { severity: "high", evidence_keywords: ["resolved", "failed", "check"] }),
      makeFinding("f-2", { severity: "critical", evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.severity).toBe("critical");
  });

  it("pattern_name is derived correctly", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.pattern_name).toBe("false-success:incident-response");
  });

  it("time_window is min/max of created_at", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-01T00:00:00Z" }),
      makeFinding("f-2", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-05T00:00:00Z" }),
    ]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.time_window).toBe("2026-05-01T00:00:00Z/2026-05-05T00:00:00Z");
  });

  it("finding_ids are sorted by created_at then finding_id", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-b", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-01T00:00:00Z" }),
      makeFinding("f-a", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-01T00:00:00Z" }),
      makeFinding("f-c", { evidence_keywords: ["resolved", "failed", "check"], created_at: "2026-05-02T00:00:00Z" }),
    ]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.finding_ids).toEqual(["f-a", "f-b", "f-c"]);
  });

  it("updateFinding is called for findings whose cluster_id changed", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);

    const result = await runClusterer({ memory });
    expect(result.updated_finding_count).toBe(1);

    const findings = await memory.listFindings();
    expect(findings[0]?.cluster_id).toBe("c-1");
  });

  it("dominant_lenses is singleton list from the cluster lens", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.dominant_lenses).toEqual(["false-success"]);
  });

  it("recommended_action from highest-severity finding", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([
      makeFinding("f-1", {
        severity: "high",
        recommended_action: "action-high",
        evidence_keywords: ["resolved", "failed", "check"],
      }),
      makeFinding("f-2", {
        severity: "critical",
        recommended_action: "action-critical",
        evidence_keywords: ["resolved", "failed", "check"],
        created_at: "2026-05-02T00:00:00Z",
      }),
    ]);
    await runClusterer({ memory });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.recommended_action).toBe("action-critical");
  });

  it("idFactory option overrides cluster id generation", async () => {
    const memory = createInMemoryAuditMemory();
    await memory.saveFindings([makeFinding("f-1")]);
    await runClusterer({ memory, idFactory: () => "injected-id" });
    const clusters = await memory.listClusters();
    expect(clusters[0]?.cluster_id).toBe("injected-id");
  });

  it("Jaccard threshold exactly 0.6 causes merge", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    // a:[w1,w2,w3,w4,w5], b:[w1,w2,w3,w6,w7,w8,w9,w10,w11,w12] — let's pick simpler set
    // 3 common, 2 total unique = 3/(2+2+3-3) = 3/4 ≥ 0.6 → merge
    await memory.saveFindings([
      makeFinding("f-1", { evidence_keywords: ["a", "b", "c", "d"] }),
      makeFinding("f-2", { evidence_keywords: ["a", "b", "c", "e"], created_at: "2026-05-02T00:00:00Z" }),
    ]);
    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(1);
  });

  it("Jaccard below threshold separates into different clusters", async () => {
    let i = 0;
    __test__setClusterIdFactory(() => `c-${++i}`);
    const memory = createInMemoryAuditMemory();
    // 1 common out of 9 distinct → jaccard = 1/9 < 0.6
    await memory.saveFindings([
      makeFinding("f-1", { evidence_keywords: ["a", "b", "c", "d", "e"] }),
      makeFinding("f-2", { evidence_keywords: ["a", "f", "g", "h", "i"], created_at: "2026-05-02T00:00:00Z" }),
    ]);
    const result = await runClusterer({ memory });
    expect(result.cluster_count).toBe(2);
  });
});
