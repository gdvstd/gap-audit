import { describe, it, expect, beforeEach } from "vitest";
import { confirmFinding } from "../confirm.js";
import { dismissFinding } from "../dismiss.js";
import { convertFindingToEval } from "../convert.js";
import { createInMemoryAuditMemory } from "../../audit-memory/index.js";
import type { AuditMemoryAdapter } from "../../audit-memory/adapter.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

const FIXED_DATE = new Date("2026-05-28T12:00:00Z");
const FIXED_NOW = () => FIXED_DATE;
const FIXED_ID = () => "eval-fixed-id";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    finding_id: "f-1",
    task_id: "task-1",
    agent_id: "agent-1",
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity: "high",
    confidence: 0.85,
    evidence: ["some evidence"],
    evidence_keywords: ["some", "evidence"],
    recommended_action: "Review",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(task_id = "task-1"): AuditArtifact {
  return {
    task_id,
    agent_id: "agent-1",
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "User asked something",
    declared_goal: "Handle user request",
    final_output_summary: "Response given",
    tool_facts: [{ tool: "policy-lookup", status: "success", fact: "Policy allows exception" }],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
  };
}

describe("confirmFinding", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  it("records a ReviewDecision with decision 'confirmed'", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    expect(result.decision.decision).toBe("confirmed");
    expect(result.decision.finding_id).toBe("f-1");
  });

  it("returns the updated finding", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    expect(result.finding.finding_id).toBe("f-1");
    expect(result.finding.updated_at).toBe("2026-05-28T12:00:00.000Z");
  });

  it("decision is persisted via listReviewDecisions", async () => {
    await mem.saveFindings([makeFinding()]);
    await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const decisions = await mem.listReviewDecisions({ finding_id: "f-1" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("confirmed");
  });

  it("includes reviewer_id when provided", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await confirmFinding({ finding_id: "f-1", memory: mem, reviewer_id: "reviewer-A", now: FIXED_NOW });
    expect(result.decision.reviewer_id).toBe("reviewer-A");
  });

  it("includes reason when provided", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await confirmFinding({ finding_id: "f-1", memory: mem, reason: "looks correct", now: FIXED_NOW });
    expect(result.decision.reason).toBe("looks correct");
  });

  it("decided_at uses injected now", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    expect(result.decision.decided_at).toBe("2026-05-28T12:00:00.000Z");
  });
});

describe("dismissFinding", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  it("records a ReviewDecision with decision 'dismissed'", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await dismissFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    expect(result.decision.decision).toBe("dismissed");
  });

  it("returns the updated finding", async () => {
    await mem.saveFindings([makeFinding()]);
    const result = await dismissFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    expect(result.finding.finding_id).toBe("f-1");
  });

  it("decision is persisted via listReviewDecisions", async () => {
    await mem.saveFindings([makeFinding()]);
    await dismissFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const decisions = await mem.listReviewDecisions({ finding_id: "f-1" });
    expect(decisions[0]?.decision).toBe("dismissed");
  });
});

describe("convertFindingToEval", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  it("throws when finding has no confirmed decision", async () => {
    await mem.saveFindings([makeFinding()]);
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    await expect(
      convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID })
    ).rejects.toThrow();
  });

  it("throws when finding has only dismissed decision", async () => {
    await mem.saveFindings([makeFinding()]);
    await dismissFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    await expect(
      convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID })
    ).rejects.toThrow();
  });

  it("throws when artifact is missing from artifactsById", async () => {
    await mem.saveFindings([makeFinding()]);
    await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const artifactsById = new Map<string, AuditArtifact>();
    await expect(
      convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID })
    ).rejects.toThrow();
  });

  it("throws when finding_id is unknown", async () => {
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    await expect(
      convertFindingToEval({ finding_id: "nonexistent", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID })
    ).rejects.toThrow();
  });

  it("returns a RegressionEvalCase with correct fields", async () => {
    await mem.saveFindings([makeFinding()]);
    await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    const evalCase = await convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(evalCase.source_finding_id).toBe("f-1");
    expect(evalCase.agent_id).toBe("agent-1");
  });

  it("saves the eval case to memory", async () => {
    await mem.saveFindings([makeFinding()]);
    await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    await convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID });
    const evalCases = await mem.listEvalCases({ source_finding_id: "f-1" });
    expect(evalCases).toHaveLength(1);
  });

  it("sets converted_to_eval=true on the finding", async () => {
    await mem.saveFindings([makeFinding()]);
    await confirmFinding({ finding_id: "f-1", memory: mem, now: FIXED_NOW });
    const artifactsById = new Map([["task-1", makeArtifact()]]);
    await convertFindingToEval({ finding_id: "f-1", memory: mem, artifactsById, now: FIXED_NOW, idFactory: FIXED_ID });
    const findings = await mem.listFindings();
    const f = findings.find((x) => x.finding_id === "f-1");
    expect(f?.converted_to_eval).toBe(true);
  });
});
