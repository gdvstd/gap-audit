import { describe, it, expect, afterAll } from "vitest";
import { runAudit } from "../agent/auditor.js";
import { createDemoAdapter } from "../agent/demo-adapter.js";
import { allLensDefinitions } from "../agent/lens-prompts.js";
import { createInMemoryAuditMemory } from "../audit-memory/index.js";
import {
  allSeedArtifacts,
  agentProfiles,
  evidenceOutputContradictionArtifact,
} from "../seeds/index.js";
import { confirmFinding } from "../review/confirm.js";
import { convertFindingToEval } from "../review/convert.js";
import { rankReviewQueue } from "../review/queue.js";
import { __test__setClusterIdFactory } from "../clusterer/cluster-id.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";

afterAll(() => {
  __test__setClusterIdFactory(null);
});

async function makeSeededRun(overrides?: { lenses?: typeof allLensDefinitions }) {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  const runInput: Parameters<typeof runAudit>[0] = {
    artifacts: allSeedArtifacts,
    adapter,
    memory,
  };
  if (overrides?.lenses !== undefined) {
    runInput.lenses = overrides.lenses;
  }
  await runAudit(runInput);
  return memory;
}

describe("End-to-end smoke: allSeedArtifacts + demo adapter", () => {
  it("runs without error", async () => {
    await expect(makeSeededRun()).resolves.not.toThrow();
  });

  describe("findings assertions", () => {
    it("produces context-neglect-gap finding for CS contradiction artifact (severity high)", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const eoFindings = findings.filter((f) => f.lens === "context-neglect-gap");
      expect(eoFindings.length).toBeGreaterThan(0);
      const csEo = eoFindings.find((f) => f.task_id === evidenceOutputContradictionArtifact.task_id);
      expect(csEo).toBeDefined();
      // Demo adapter produces high (the PRD §14 / 04-audit-lenses.md spec)
      expect(["high", "critical"]).toContain(csEo?.severity);
    });

    it("produces trust-damaging-service findings for recruiting artifact", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const prFindings = findings.filter((f) => f.lens === "trust-damaging-service");
      expect(prFindings.length).toBeGreaterThan(0);
    });

    it("produces resolved-but-not-served findings for the DevOps artifacts", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const fsFindings = findings.filter(
        (f) => f.lens === "resolved-but-not-served" && f.agent_id === "agent-devops-01"
      );
      expect(fsFindings.length).toBeGreaterThan(0);
    });

    it("produces operational-drift findings for the CS guardrail artifacts", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const gfFindings = findings.filter((f) => f.lens === "operational-drift");
      expect(gfFindings.length).toBeGreaterThan(0);
    });

    it("produces at least one operational-drift pattern finding for DevOps agent", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const lrFindings = findings.filter(
        (f) => f.lens === "operational-drift" && f.agent_id === "agent-devops-01"
      );
      expect(lrFindings.length).toBeGreaterThan(0);
    });

    it("all findings validate via validateAuditFinding", async () => {
      const { validateAuditFinding } = await import("../contracts/index.js");
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      for (const f of findings) {
        const result = validateAuditFinding(f);
        expect(result.ok, `finding ${f.finding_id} failed: ${!result.ok ? result.errors.join(", ") : ""}`).toBe(true);
      }
    });

    it("findings carry task_type from their source artifact", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const devopsFindings = findings.filter((f) => f.agent_id === "agent-devops-01");
      for (const f of devopsFindings) {
        expect(f.task_type).toBe("incident-response");
      }
    });

    it("covers all four PRD demo failure modes", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const failureModes = new Set(findings.map((f) => f.failure_mode));
      expect(failureModes.has("Evidence-Output Contradiction")).toBe(true);
      expect(failureModes.has("Trust-Damaging Retention")).toBe(true);
      expect(failureModes.has("False Success")).toBe(true);
      // Latent risk or guardrail friction lens must produce at least one finding
      const hasPatternLens = findings.some(
        (f) => f.lens === "operational-drift"
      );
      expect(hasPatternLens).toBe(true);
    });

    it("control artifacts produce zero findings", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const CONTROL_TASK_IDS = new Set([
        "task-ctrl-support-001",
        "task-ctrl-devops-001",
        "task-ctrl-recruit-001",
      ]);
      const controlFindings = findings.filter((f) => CONTROL_TASK_IDS.has(f.task_id));
      expect(controlFindings).toHaveLength(0);
    });
  });

  describe("cluster assertions", () => {
    it("produces clusters after run", async () => {
      const memory = await makeSeededRun();
      const clusters = await memory.listClusters();
      expect(clusters.length).toBeGreaterThan(0);
    });

    it("there are resolved-but-not-served clusters for DevOps agent", async () => {
      const memory = await makeSeededRun();
      const clusters = await memory.listClusters();
      const fsClusters = clusters.filter(
        (c) =>
          c.agent_id === "agent-devops-01" &&
          c.dominant_lenses.includes("resolved-but-not-served")
      );
      expect(fsClusters.length).toBeGreaterThan(0);
    });

    it("there is an operational-drift cluster for CS agent", async () => {
      const memory = await makeSeededRun();
      const clusters = await memory.listClusters();
      const gfCluster = clusters.find(
        (c) =>
          c.agent_id === "agent-support-01" &&
          c.dominant_lenses.includes("operational-drift")
      );
      expect(gfCluster).toBeDefined();
      expect(gfCluster!.finding_count).toBeGreaterThan(0);
    });

    it("there is an operational-drift cluster for DevOps agent", async () => {
      const memory = await makeSeededRun();
      const clusters = await memory.listClusters();
      const lrCluster = clusters.find(
        (c) =>
          c.agent_id === "agent-devops-01" &&
          c.dominant_lenses.includes("operational-drift")
      );
      expect(lrCluster).toBeDefined();
    });

    it("all resolved-but-not-served DevOps findings have a cluster_id set", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings({ agent_id: "agent-devops-01" });
      const fsFindings = findings.filter((f) => f.lens === "resolved-but-not-served");
      for (const f of fsFindings) {
        expect(f.cluster_id).toBeDefined();
        expect(typeof f.cluster_id).toBe("string");
      }
    });
  });

  describe("review and convert-to-eval flow", () => {
    it("confirms a finding and converts to eval", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const eoFinding = findings.find((f) => f.lens === "context-neglect-gap");
      expect(eoFinding).toBeDefined();

      if (!eoFinding) return;

      const FIXED_NOW = () => new Date("2026-05-28T00:00:00Z");
      await confirmFinding({ finding_id: eoFinding.finding_id, memory, now: FIXED_NOW });

      const artifactsById = new Map<string, AuditArtifact>(
        allSeedArtifacts.map((a) => [a.task_id, a])
      );
      const evalCase = await convertFindingToEval({
        finding_id: eoFinding.finding_id,
        memory,
        artifactsById,
        now: FIXED_NOW,
      });

      expect(evalCase.source_finding_id).toBe(eoFinding.finding_id);
      expect(evalCase.agent_id).toBe(eoFinding.agent_id);
      expect(typeof evalCase.eval_id).toBe("string");
      expect(evalCase.expected_behavior.length).toBeGreaterThan(0);

      const updatedFindings = await memory.listFindings();
      const updated = updatedFindings.find((f) => f.finding_id === eoFinding.finding_id);
      expect(updated?.converted_to_eval).toBe(true);
    });

    it("rankReviewQueue surfaces high-severity findings first", async () => {
      const memory = await makeSeededRun();
      const findings = await memory.listFindings();
      const clusters = await memory.listClusters();

      const ranked = rankReviewQueue({ findings, clusters });
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0]?.severity === "critical" || ranked[0]?.severity === "high").toBe(true);
    });
  });
});
