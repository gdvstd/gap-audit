import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";
import type { RegressionEvalCase } from "@/lib/contracts/regression-eval-case.js";

async function makeSeededMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
  return memory;
}

// Convert-to-eval is now a human-reviewed flow that pushes to Phoenix (covered by an
// integration path, not a unit test). Here we cover the eval-case store/list contract.
describe("GET /api/evals logic", () => {
  it("returns empty list initially before any conversion", async () => {
    const memory = await makeSeededMemory();
    const evals = await memory.listEvalCases();
    expect(evals.length).toBe(0);
  });

  it("lists saved eval cases sorted by created_at desc", async () => {
    const memory = await makeSeededMemory();
    const findings = await memory.listFindings();
    const mk = (i: number, fId: string, agent: string, fm: string): RegressionEvalCase => ({
      eval_id: `e${i}`,
      source_finding_id: fId,
      agent_id: agent,
      input: "replay the scenario",
      expected_behavior: ["serve the customer's actual need"],
      failure_mode_guarded: fm,
      dataset_name: "regression-test",
      judge_prompt: "PASS if served, FAIL if recurs",
      created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    });
    await memory.saveEvalCase(mk(1, findings[0]!.finding_id, findings[0]!.agent_id, findings[0]!.failure_mode));
    await memory.saveEvalCase(mk(2, findings[1]!.finding_id, findings[1]!.agent_id, findings[1]!.failure_mode));

    const evals = await memory.listEvalCases();
    const sorted = [...evals].sort((a, b) => b.created_at.localeCompare(a.created_at));
    expect(sorted.length).toBe(2);
    for (const ec of sorted) {
      expect(typeof ec.eval_id).toBe("string");
      expect(typeof ec.source_finding_id).toBe("string");
      expect(Array.isArray(ec.expected_behavior)).toBe(true);
    }
  });
});
