/**
 * Tests for runAuditSweep — autonomous sweep over unaudited artifacts.
 *
 * Uses createDemoAdapter() and a fresh in-memory store seeded with artifacts.
 * Verifies idempotency: second sweep adds no findings.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runAuditSweep } from "../sweep.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import { createDemoAdapter } from "../demo-adapter.js";
import { allSeedArtifacts, agentProfiles } from "../../seeds/index.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

function makeArtifact(task_id: string, agent_id = "agent-test"): AuditArtifact {
  return {
    task_id,
    agent_id,
    timestamp: "2026-06-01T00:00:00Z",
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

const FIXED_DATE = new Date("2026-06-01T00:00:00.000Z");
let idCounter = 0;
const makeFixedIdFactory = () => {
  idCounter = 0;
  return () => `sweep-id-${++idCounter}`;
};

describe("runAuditSweep", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe("return shape", () => {
    it("returns the expected fields", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      const result = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        now: () => FIXED_DATE,
        idFactory: makeFixedIdFactory(),
      });

      expect(typeof result.run_id).toBe("string");
      expect(Array.isArray(result.audited_task_ids)).toBe(true);
      expect(Array.isArray(result.skipped_task_ids)).toBe(true);
      expect(typeof result.new_finding_count).toBe("number");
      expect(Array.isArray(result.finding_ids)).toBe(true);
    });

    it("finding_ids length matches new_finding_count", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      const result = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
      });

      expect(result.finding_ids).toHaveLength(result.new_finding_count);
    });
  });

  describe("first sweep — fresh store", () => {
    it("audits all seed artifacts on first sweep", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      const result = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        now: () => FIXED_DATE,
        idFactory: makeFixedIdFactory(),
      });

      expect(result.audited_task_ids).toHaveLength(allSeedArtifacts.length);
      expect(result.skipped_task_ids).toHaveLength(0);
      expect(result.new_finding_count).toBeGreaterThan(0);
    });

    it("marks all artifact task_ids as audited after sweep", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });

      const audited = await memory.listAuditedTaskIds();
      const expectedIds = allSeedArtifacts.map((a) => a.task_id);
      for (const id of expectedIds) {
        expect(audited).toContain(id);
      }
    });

    it("persists findings to memory after sweep", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      const result = await runAuditSweep({ memory, adapter: createDemoAdapter() });

      const findings = await memory.listFindings();
      expect(findings.length).toBe(result.new_finding_count);
    });
  });

  describe("second sweep — idempotency", () => {
    it("second sweep returns audited_task_ids=[], skipped=all (no re-audit)", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      // First sweep
      const r1 = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        now: () => FIXED_DATE,
        idFactory: makeFixedIdFactory(),
      });

      // Second sweep — same adapter, same memory
      const r2 = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        now: () => FIXED_DATE,
        idFactory: makeFixedIdFactory(),
      });

      expect(r2.audited_task_ids).toHaveLength(0);
      expect(r2.skipped_task_ids).toHaveLength(allSeedArtifacts.length);
      expect(r2.new_finding_count).toBe(0);
      expect(r2.finding_ids).toHaveLength(0);

      // Findings count must not grow on second sweep
      const findingsAfterFirst = await memory.listFindings();
      expect(findingsAfterFirst.length).toBe(r1.new_finding_count);
    });

    it("second sweep does not increase the findings count in memory", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });
      const countAfterFirst = (await memory.listFindings()).length;

      await runAuditSweep({ memory, adapter: createDemoAdapter() });
      const countAfterSecond = (await memory.listFindings()).length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it("second sweep returns a valid run_id even when no work done", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });
      const r2 = await runAuditSweep({ memory, adapter: createDemoAdapter() });

      expect(typeof r2.run_id).toBe("string");
      expect(r2.run_id.length).toBeGreaterThan(0);
    });

    it("run_id differs between sweeps", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      let counter = 0;
      const r1 = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        idFactory: () => `id-${++counter}`,
      });
      const r2 = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        idFactory: () => `id-${++counter}`,
      });

      expect(r1.run_id).not.toBe(r2.run_id);
    });
  });

  describe("incremental sweep — new artifact after first sweep", () => {
    it("only audits the new artifact on the second sweep", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      // First sweep — audits everything
      await runAuditSweep({ memory, adapter: createDemoAdapter() });

      // Add a brand new artifact (unknown to demo adapter → no findings, but still swept)
      const newArtifact = makeArtifact("task-brand-new-001");
      await memory.saveArtifacts([newArtifact]);

      // Second sweep — should only touch the new artifact
      const r2 = await runAuditSweep({ memory, adapter: createDemoAdapter() });

      expect(r2.audited_task_ids).toHaveLength(1);
      expect(r2.audited_task_ids).toContain("task-brand-new-001");
      expect(r2.skipped_task_ids).toHaveLength(allSeedArtifacts.length);
      expect(r2.skipped_task_ids).not.toContain("task-brand-new-001");
    });

    it("marks the new artifact as audited after incremental sweep", async () => {
      const memory = createInMemoryAuditMemory();
      await memory.saveArtifacts(allSeedArtifacts);
      await memory.saveAgentProfiles(agentProfiles);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });

      const newArtifact = makeArtifact("task-incremental-001");
      await memory.saveArtifacts([newArtifact]);
      await runAuditSweep({ memory, adapter: createDemoAdapter() });

      const audited = await memory.listAuditedTaskIds();
      expect(audited).toContain("task-incremental-001");
    });
  });

  describe("empty store", () => {
    it("returns empty lists when no artifacts in store", async () => {
      const memory = createInMemoryAuditMemory();

      const result = await runAuditSweep({ memory, adapter: createDemoAdapter() });

      expect(result.audited_task_ids).toHaveLength(0);
      expect(result.skipped_task_ids).toHaveLength(0);
      expect(result.new_finding_count).toBe(0);
      expect(result.finding_ids).toHaveLength(0);
    });
  });

  describe("determinism", () => {
    it("is deterministic with fixed now and idFactory", async () => {
      const memory = createInMemoryAuditMemory();
      // Use a minimal single-artifact store for determinism
      const artifact = makeArtifact("task-refund-001", "agent-support-01");
      await memory.saveArtifacts([artifact]);
      await memory.saveAgentProfiles(agentProfiles);

      let counter = 0;
      const result = await runAuditSweep({
        memory,
        adapter: createDemoAdapter(),
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        idFactory: () => `fixed-${++counter}`,
      });

      expect(result.run_id).toBe("fixed-1");
      expect(result.audited_task_ids).toContain("task-refund-001");
    });
  });

  describe("clean artifacts still get marked swept", () => {
    it("artifacts that produce zero findings are still marked audited", async () => {
      const memory = createInMemoryAuditMemory();
      // Only add a control artifact (demo adapter produces no findings for it)
      const cleanArtifact = makeArtifact("task-control-clean-001");
      await memory.saveArtifacts([cleanArtifact]);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });

      const audited = await memory.listAuditedTaskIds();
      expect(audited).toContain("task-control-clean-001");
    });

    it("clean artifact is not re-audited on second sweep", async () => {
      const memory = createInMemoryAuditMemory();
      const cleanArtifact = makeArtifact("task-control-clean-002");
      await memory.saveArtifacts([cleanArtifact]);

      await runAuditSweep({ memory, adapter: createDemoAdapter() });
      const r2 = await runAuditSweep({ memory, adapter: createDemoAdapter() });

      expect(r2.audited_task_ids).toHaveLength(0);
      expect(r2.skipped_task_ids).toContain("task-control-clean-002");
    });
  });
});
