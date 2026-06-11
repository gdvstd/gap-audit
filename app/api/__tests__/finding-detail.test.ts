import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";
import { getFindingDetail } from "../findings/[id]/logic.js";

async function makeSeededMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
  return memory;
}

describe("getFindingDetail", () => {
  it("returns 404 for unknown finding_id", async () => {
    const memory = await makeSeededMemory();
    const result = await getFindingDetail(memory, "nonexistent-id");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.error).toContain("not found");
  });

  it("returns finding detail for valid finding_id", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await getFindingDetail(memory, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finding.finding_id).toBe(id);
  });

  it("returns empty decisions array for unreviewed finding", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await getFindingDetail(memory, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.value.decisions)).toBe(true);
    expect(result.value.decisions.length).toBe(0);
  });

  it("includes artifact when task_id matches seed data", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const findingWithArtifact = findings.find(
      (f) => allSeedArtifacts.some((a) => a.task_id === f.task_id)
    );
    if (findingWithArtifact === undefined) return;
    const result = await getFindingDetail(memory, findingWithArtifact.finding_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artifact).toBeDefined();
    expect(result.value.artifact?.task_id).toBe(findingWithArtifact.task_id);
  });

  it("includes cluster when finding has cluster_id", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const clusteredFinding = findings.find((f) => f.cluster_id !== undefined);
    if (clusteredFinding === undefined) return;
    const result = await getFindingDetail(memory, clusteredFinding.finding_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cluster).toBeDefined();
    expect(result.value.cluster?.cluster_id).toBe(clusteredFinding.cluster_id);
  });

  it("does not include cluster when finding has no cluster_id", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const unclustered = findings.find((f) => f.cluster_id === undefined);
    if (unclustered === undefined) return;
    const result = await getFindingDetail(memory, unclustered.finding_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cluster).toBeUndefined();
  });

  it("does not include evalCase when finding is not converted", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const notConverted = findings.find((f) => !f.converted_to_eval);
    if (notConverted === undefined) return;
    const result = await getFindingDetail(memory, notConverted.finding_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evalCase).toBeUndefined();
  });
});
