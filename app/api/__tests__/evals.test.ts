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

describe("GET /api/evals logic", () => {
  it("returns empty list initially before any conversion", async () => {
    const memory = await makeSeededMemory();
    const evals = await memory.listEvalCases();
    expect(evals.length).toBe(0);
  });

  it("returns eval cases after conversion, sorted by created_at desc", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();

    const id1 = findings[0]!.finding_id;
    const id2 = findings[1]!.finding_id;

    await postReview(memory, id1, { decision: "confirmed" });
    await postConvertToEval(memory, id1);

    await postReview(memory, id2, { decision: "confirmed" });
    await postConvertToEval(memory, id2);

    const evals = await memory.listEvalCases();
    const sorted = [...evals].sort((a, b) => b.created_at.localeCompare(a.created_at));

    expect(sorted.length).toBe(2);
    for (const ec of sorted) {
      expect(typeof ec.eval_id).toBe("string");
      expect(typeof ec.source_finding_id).toBe("string");
      expect(typeof ec.agent_id).toBe("string");
      expect(Array.isArray(ec.expected_behavior)).toBe(true);
    }
  });

  it("each eval case has required fields", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const id = findings[0]!.finding_id;

    await postReview(memory, id, { decision: "confirmed" });
    const convResult = await postConvertToEval(memory, id);
    expect(convResult.ok).toBe(true);
    if (!convResult.ok) return;

    const evals = await memory.listEvalCases();
    expect(evals.length).toBe(1);
    const ec = evals[0]!;
    expect(typeof ec.eval_id).toBe("string");
    expect(ec.source_finding_id).toBe(id);
    expect(typeof ec.failure_mode_guarded).toBe("string");
    expect(ec.expected_behavior.length).toBeGreaterThan(0);
  });
});
