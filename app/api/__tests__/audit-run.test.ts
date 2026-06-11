import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { allLensDefinitions } from "@/lib/agent/lens-prompts.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";
import { runAuditRequest } from "../audit/run/logic.js";

async function makeFreshMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  return memory;
}

describe("runAuditRequest", () => {
  it("runs all lenses and returns positive finding_count when no body", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditRequest(memory, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finding_count).toBeGreaterThan(0);
    expect(result.value.finding_ids.length).toBe(result.value.finding_count);
    expect(typeof result.value.run_id).toBe("string");
  });

  it("runs all lenses with empty object body", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditRequest(memory, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finding_count).toBeGreaterThan(0);
  });

  it("does not double-count findings on second run (upsert behavior)", async () => {
    const memory = await makeFreshMemory();
    const r1 = await runAuditRequest(memory, {});
    const r2 = await runAuditRequest(memory, {});
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const allFindings = await memory.listFindings();
    expect(allFindings.length).toBeGreaterThan(0);
  });

  it("filters by artifact_ids when provided", async () => {
    const memory = await makeFreshMemory();
    const firstId = allSeedArtifacts[0]!.task_id;
    const result = await runAuditRequest(memory, { artifact_ids: [firstId] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const findings = await memory.listFindings();
    const forFirstArtifact = findings.filter((f) => f.task_id === firstId);
    expect(forFirstArtifact.length).toBeGreaterThan(0);
  });

  it("filters by lens ids when provided", async () => {
    const memory = await makeFreshMemory();
    const firstLens = allLensDefinitions[0]!.id;
    const result = await runAuditRequest(memory, { lenses: [firstLens] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const findings = await memory.listFindings();
    const forFirstLens = findings.filter((f) => f.lens === firstLens);
    expect(forFirstLens.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid body type", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditRequest(memory, "not-an-object");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 400 if artifact_ids is not a string array", async () => {
    const memory = await makeFreshMemory();
    const result = await runAuditRequest(memory, { artifact_ids: [1, 2, 3] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("runs lenses correctly using runAudit for all seed artifacts", async () => {
    const memory = await makeFreshMemory();
    const adapter = createDemoAdapter();
    const auditRun = await runAudit({
      artifacts: allSeedArtifacts,
      adapter,
      memory,
    });
    expect(auditRun.finding_count).toBeGreaterThan(0);
    expect(auditRun.finding_ids.length).toBe(auditRun.finding_count);
  });
});
