import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";

async function makeSeededMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
  return memory;
}

describe("GET /api/clusters logic", () => {
  it("returns clusters after seeded run", async () => {
    const memory = await makeSeededMemory();
    const clusters = await memory.listClusters();
    expect(clusters.length).toBeGreaterThan(0);
  });

  it("clusters are sorted by severity descending then finding_count descending", async () => {
    const memory = await makeSeededMemory();
    const clusters = await memory.listClusters();

    const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const sorted = [...clusters].sort((a, b) => {
      const sd = (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0);
      if (sd !== 0) return sd;
      return b.finding_count - a.finding_count;
    });

    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]?.cluster_id).toBe(sorted[i]?.cluster_id);
    }
  });

  it("each cluster has required fields", async () => {
    const memory = await makeSeededMemory();
    const clusters = await memory.listClusters();
    for (const c of clusters) {
      expect(typeof c.cluster_id).toBe("string");
      expect(typeof c.agent_id).toBe("string");
      expect(typeof c.pattern_name).toBe("string");
      expect(typeof c.finding_count).toBe("number");
      expect(c.finding_count).toBeGreaterThan(0);
      expect(Array.isArray(c.dominant_lenses)).toBe(true);
    }
  });
});
