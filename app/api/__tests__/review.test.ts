import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";
import { postReview } from "../findings/[id]/review/logic.js";
import { postConvertToEval } from "../findings/[id]/convert-to-eval/logic.js";

async function makeSeededMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
  return memory;
}

describe("postReview", () => {
  it("confirms a finding", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await postReview(memory, id, { decision: "confirmed" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.decision).toBe("confirmed");
    expect(result.value.decision.finding_id).toBe(id);
  });

  it("dismisses a finding", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await postReview(memory, id, { decision: "dismissed", reason: "false positive" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.decision).toBe("dismissed");
    expect(result.value.decision.reason).toBe("false positive");
  });

  it("returns 404 for nonexistent finding", async () => {
    const memory = await makeSeededMemory();
    const result = await postReview(memory, "bogus-id", { decision: "confirmed" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("returns 400 for invalid decision value", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await postReview(memory, id, { decision: "invalid" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 400 for null body", async () => {
    const memory = await makeSeededMemory();
    const result = await postReview(memory, "any-id", null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 400 for array body", async () => {
    const memory = await makeSeededMemory();
    const result = await postReview(memory, "any-id", []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});

// The convert success path pushes to Phoenix (integration), so unit tests cover the
// guard rails that return BEFORE any network call.
describe("postConvertToEval guards", () => {
  it("returns 404 for nonexistent finding", async () => {
    const memory = await makeSeededMemory();
    const result = await postConvertToEval(memory, "nonexistent", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("returns 400 if finding is not confirmed", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await postConvertToEval(memory, id, { input: "x", dataset_name: "d", target: "new", judge_prompt: "j" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 400 when the test input is missing", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    await postReview(memory, id, { decision: "confirmed" });
    const result = await postConvertToEval(memory, id, { dataset_name: "d", target: "new", judge_prompt: "j" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});
