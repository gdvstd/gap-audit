/**
 * Tests for the audit sweep API route logic.
 * Mirrors audit-run.test.ts — uses a fresh in-memory store.
 */
import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAuditSweepRequest } from "../audit/sweep/logic.js";

async function makeFreshMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  return memory;
}

describe("runAuditSweepRequest", () => {
  it("first sweep finds positive finding_count and valid run_id", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditSweepRequest(memory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.run_id).toBe("string");
    expect(result.value.new_finding_count).toBeGreaterThan(0);
    expect(result.value.finding_ids).toHaveLength(result.value.new_finding_count);
    expect(result.value.audited_task_ids).toHaveLength(allSeedArtifacts.length);
    expect(result.value.skipped_task_ids).toHaveLength(0);
  });

  it("second sweep is idempotent: no new findings", async () => {
    const memory = await makeFreshMemory();

    const r1 = await runAuditSweepRequest(memory);
    expect(r1.ok).toBe(true);

    const r2 = await runAuditSweepRequest(memory);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r2.value.new_finding_count).toBe(0);
    expect(r2.value.audited_task_ids).toHaveLength(0);
    expect(r2.value.skipped_task_ids).toHaveLength(allSeedArtifacts.length);
  });

  it("findings count in memory does not increase after second sweep", async () => {
    const memory = await makeFreshMemory();

    await runAuditSweepRequest(memory);
    const countAfterFirst = (await memory.listFindings()).length;

    await runAuditSweepRequest(memory);
    const countAfterSecond = (await memory.listFindings()).length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("returns ok: true with valid shape every time", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditSweepRequest(memory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v = result.value;
    expect(typeof v.run_id).toBe("string");
    expect(Array.isArray(v.audited_task_ids)).toBe(true);
    expect(Array.isArray(v.skipped_task_ids)).toBe(true);
    expect(typeof v.new_finding_count).toBe("number");
    expect(Array.isArray(v.finding_ids)).toBe(true);
  });
});
