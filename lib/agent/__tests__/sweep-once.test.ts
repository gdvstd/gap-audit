/**
 * Tests for sweepOnce — the extracted single-iteration function from audit-loop.
 * Tests that sweepOnce runs a sweep and returns the summary correctly.
 */
import { describe, it, expect } from "vitest";
import { sweepOnce } from "../../runtime/sweep-once.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import { createDemoAdapter } from "../demo-adapter.js";
import { allSeedArtifacts, agentProfiles } from "../../seeds/index.js";

describe("sweepOnce", () => {
  it("returns a sweep summary with correct shape", async () => {
    const memory = createInMemoryAuditMemory();
    await memory.saveArtifacts(allSeedArtifacts);
    await memory.saveAgentProfiles(agentProfiles);

    const result = await sweepOnce(memory, createDemoAdapter());

    expect(typeof result.run_id).toBe("string");
    expect(Array.isArray(result.audited_task_ids)).toBe(true);
    expect(Array.isArray(result.skipped_task_ids)).toBe(true);
    expect(typeof result.new_finding_count).toBe("number");
    expect(Array.isArray(result.finding_ids)).toBe(true);
  });

  it("first call audits all fresh artifacts", async () => {
    const memory = createInMemoryAuditMemory();
    await memory.saveArtifacts(allSeedArtifacts);
    await memory.saveAgentProfiles(agentProfiles);

    const result = await sweepOnce(memory, createDemoAdapter());

    expect(result.audited_task_ids).toHaveLength(allSeedArtifacts.length);
    expect(result.new_finding_count).toBeGreaterThan(0);
  });

  it("second call is a no-op (idempotent)", async () => {
    const memory = createInMemoryAuditMemory();
    await memory.saveArtifacts(allSeedArtifacts);
    await memory.saveAgentProfiles(agentProfiles);

    await sweepOnce(memory, createDemoAdapter());
    const r2 = await sweepOnce(memory, createDemoAdapter());

    expect(r2.audited_task_ids).toHaveLength(0);
    expect(r2.skipped_task_ids).toHaveLength(allSeedArtifacts.length);
    expect(r2.new_finding_count).toBe(0);
  });

  it("works with empty store", async () => {
    const memory = createInMemoryAuditMemory();
    const result = await sweepOnce(memory, createDemoAdapter());
    expect(result.new_finding_count).toBe(0);
    expect(result.audited_task_ids).toHaveLength(0);
  });
});
