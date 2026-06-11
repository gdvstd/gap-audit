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

describe("postConvertToEval", () => {
  it("converts a confirmed finding to eval", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;

    await postReview(memory, id, { decision: "confirmed" });
    const result = await postConvertToEval(memory, id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.eval_id).toBe("string");
    expect(result.value.source_finding_id).toBe(id);
  });

  it("sets converted_to_eval=true on the finding after conversion", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;

    await postReview(memory, id, { decision: "confirmed" });
    await postConvertToEval(memory, id);

    const allFindings = await memory.listFindings();
    const updated = allFindings.find((f) => f.finding_id === id);
    expect(updated?.converted_to_eval).toBe(true);
  });

  it("returns 400 if finding is not confirmed", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;
    const result = await postConvertToEval(memory, id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 404 for nonexistent finding", async () => {
    const memory = await makeSeededMemory();
    const result = await postConvertToEval(memory, "nonexistent");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
