/**
 * Tests for the demo adapter (createDemoAdapter).
 *
 * Verifies that running runAudit with the demo adapter over allSeedArtifacts
 * produces findings for all four PRD demo cases and ZERO findings for
 * control task_ids.
 */
import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "../../audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "../../seeds/index.js";
import { runAudit } from "../auditor.js";
import { createDemoAdapter } from "../demo-adapter.js";

// Fixed deterministic id factory and clock
let idSeq = 0;
const fixedIdFactory = () => `test-id-${++idSeq}`;
const FIXED_NOW = () => new Date("2026-05-28T00:00:00Z");

// Control task IDs (should produce zero findings)
const CONTROL_TASK_IDS = new Set([
  "task-ctrl-support-001",
  "task-ctrl-devops-001",
  "task-ctrl-recruit-001",
]);

// Demo case task IDs
const REFUND_TASK_ID = "task-refund-001";
const RECRUIT_TASK_ID = "task-recruit-001";
const GUARDRAIL_TASK_IDS = new Set([
  "task-support-gf-001",
  "task-support-gf-002",
  "task-support-gf-003",
  "task-support-gf-004",
  "task-support-gf-005",
  "task-support-gf-006",
]);
const DEVOPS_TASK_IDS = new Set([
  "task-devops-frd-001",
  "task-devops-frd-002",
  "task-devops-frd-003",
  "task-devops-frd-004",
  "task-devops-frd-005",
  "task-devops-frd-006",
  "task-devops-frd-007",
  "task-devops-frd-008",
  "task-devops-frd-009",
]);

async function makeSeededRun() {
  idSeq = 0;
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  const result = await runAudit({
    artifacts: allSeedArtifacts,
    adapter,
    memory,
    now: FIXED_NOW,
    idFactory: fixedIdFactory,
  });
  const findings = await memory.listFindings();
  return { result, findings, memory };
}

describe("createDemoAdapter", () => {
  it("name is 'demo-scripted'", () => {
    const adapter = createDemoAdapter();
    expect(adapter.name).toBe("demo-scripted");
  });

  it("enabled() returns true", () => {
    const adapter = createDemoAdapter();
    expect(adapter.enabled()).toBe(true);
  });

  describe("runAudit with demo adapter over allSeedArtifacts", () => {
    it("completes without throwing", async () => {
      await expect(makeSeededRun()).resolves.not.toThrow();
    });

    it("returns positive finding_count", async () => {
      const { result } = await makeSeededRun();
      expect(result.finding_count).toBeGreaterThan(0);
    });

    it("produces an Evidence-Output Contradiction finding for the refund artifact", async () => {
      const { findings } = await makeSeededRun();
      const eoFindings = findings.filter(
        (f) => f.task_id === REFUND_TASK_ID && f.failure_mode === "Evidence-Output Contradiction"
      );
      expect(eoFindings.length).toBeGreaterThan(0);
      expect(eoFindings[0]?.lens).toBe("context-neglect-gap");
      expect(eoFindings[0]?.severity).toBe("high");
    });

    it("produces a Trust-Damaging Retention finding for the recruiting artifact", async () => {
      const { findings } = await makeSeededRun();
      const prFindings = findings.filter(
        (f) => f.task_id === RECRUIT_TASK_ID && f.failure_mode === "Trust-Damaging Retention"
      );
      expect(prFindings.length).toBeGreaterThan(0);
      expect(prFindings[0]?.lens).toBe("trust-damaging-service");
      expect(prFindings[0]?.severity).toBe("high");
    });

    it("produces Guardrail Friction findings for guardrail artifacts", async () => {
      const { findings } = await makeSeededRun();
      const gfFindings = findings.filter(
        (f) => GUARDRAIL_TASK_IDS.has(f.task_id) && f.lens === "operational-drift"
      );
      expect(gfFindings.length).toBeGreaterThan(0);
      const gfAgent = gfFindings[0];
      expect(gfAgent?.agent_id).toBe("agent-support-01");
    });

    it("produces False Success findings for DevOps artifacts", async () => {
      const { findings } = await makeSeededRun();
      const fsFindings = findings.filter(
        (f) => DEVOPS_TASK_IDS.has(f.task_id) && f.failure_mode === "False Success"
      );
      expect(fsFindings.length).toBeGreaterThan(0);
      expect(fsFindings[0]?.lens).toBe("resolved-but-not-served");
      expect(fsFindings[0]?.severity).toBe("high");
    });

    it("produces at least one Latent Risk Pattern finding for later DevOps artifacts", async () => {
      const { findings } = await makeSeededRun();
      const lrFindings = findings.filter(
        (f) =>
          DEVOPS_TASK_IDS.has(f.task_id) &&
          f.lens === "operational-drift"
      );
      expect(lrFindings.length).toBeGreaterThan(0);
    });

    it("produces ZERO findings for all control task_ids", async () => {
      const { findings } = await makeSeededRun();
      const controlFindings = findings.filter((f) => CONTROL_TASK_IDS.has(f.task_id));
      expect(controlFindings).toHaveLength(0);
    });

    it("all findings have non-empty evidence arrays", async () => {
      const { findings } = await makeSeededRun();
      for (const f of findings) {
        expect(f.evidence.length).toBeGreaterThan(0);
      }
    });

    it("trust-damaging service findings explain the service risk", async () => {
      const { findings } = await makeSeededRun();
      const finding = findings.find((f) => f.task_id === "task-recruit-001");
      expect(finding).toBeDefined();
      expect(finding?.lens).toBe("trust-damaging-service");
      expect(finding?.evidence.join("\n")).toContain("trust-damaging gap");
      expect(finding?.recommended_action).toContain("retention policy");
    });

    it("all findings pass validateAuditFinding", async () => {
      const { findings } = await makeSeededRun();
      const { validateAuditFinding } = await import("../../contracts/index.js");
      for (const f of findings) {
        const r = validateAuditFinding(f);
        expect(r.ok, `finding ${f.finding_id}: ${!r.ok ? r.errors.join(", ") : ""}`).toBe(true);
      }
    });

    it("findings cover all four demo failure modes", async () => {
      const { findings } = await makeSeededRun();
      const failureModes = new Set(findings.map((f) => f.failure_mode));
      expect(failureModes.has("Evidence-Output Contradiction")).toBe(true);
      expect(failureModes.has("Trust-Damaging Retention")).toBe(true);
      expect(failureModes.has("False Success")).toBe(true);
      // Latent risk pattern or guardrail friction
      const hasGuardrailOrLatent =
        failureModes.has("Guardrail Friction") ||
        failureModes.has("Repeated Privacy Guardrail Block") ||
        findings.some((f) => f.lens === "operational-drift");
      expect(hasGuardrailOrLatent).toBe(true);
    });

    it("human_review_required is true for all demo findings", async () => {
      const { findings } = await makeSeededRun();
      for (const f of findings) {
        expect(f.human_review_required).toBe(true);
      }
    });

    it("clusters are produced after the run", async () => {
      const { memory } = await makeSeededRun();
      const clusters = await memory.listClusters();
      expect(clusters.length).toBeGreaterThan(0);
    });
  });
});
