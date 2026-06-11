import { describe, it, expect } from "vitest";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createDemoAdapter } from "@/lib/agent/demo-adapter.js";
import { parseQuery, listFindingsRequest } from "../findings/logic.js";

async function makeSeededMemory() {
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  const adapter = createDemoAdapter();
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
  return memory;
}

describe("parseQuery", () => {
  it("returns empty query for empty params", () => {
    const q = parseQuery(new URLSearchParams());
    expect(q).toEqual({});
  });

  it("parses severity correctly", () => {
    const q = parseQuery(new URLSearchParams("severity=high"));
    expect(q.severity).toBe("high");
  });

  it("ignores invalid severity values", () => {
    const q = parseQuery(new URLSearchParams("severity=invalid"));
    expect(q.severity).toBeUndefined();
  });

  it("parses all query params", () => {
    const q = parseQuery(new URLSearchParams("severity=critical&lens=evidence-output&agent_id=agent-1&status=pending"));
    expect(q.severity).toBe("critical");
    expect(q.lens).toBe("evidence-output");
    expect(q.agent_id).toBe("agent-1");
    expect(q.status).toBe("pending");
  });

  it("ignores invalid status values", () => {
    const q = parseQuery(new URLSearchParams("status=bogus"));
    expect(q.status).toBeUndefined();
  });
});

describe("listFindingsRequest", () => {
  it("returns all findings with no filter", async () => {
    const memory = await makeSeededMemory();
    const result = await listFindingsRequest(memory, {});
    expect(result.count).toBeGreaterThan(0);
    expect(result.findings.length).toBe(result.count);
  });

  it("returns findings ranked by severity descending", async () => {
    const memory = await makeSeededMemory();
    const result = await listFindingsRequest(memory, {});
    const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    for (let i = 1; i < result.findings.length; i++) {
      const prev = result.findings[i - 1]!;
      const curr = result.findings[i]!;
      expect((RANK[prev.severity] ?? 0) >= (RANK[curr.severity] ?? 0)).toBe(true);
    }
  });

  it("filters by severity=high", async () => {
    const memory = await makeSeededMemory();
    const result = await listFindingsRequest(memory, { severity: "high" });
    for (const f of result.findings) {
      expect(f.severity).toBe("high");
    }
  });

  it("filters by lens", async () => {
    const memory = await makeSeededMemory();
    const allResult = await listFindingsRequest(memory, {});
    const firstLens = allResult.findings[0]?.lens;
    if (firstLens === undefined) return;
    const filtered = await listFindingsRequest(memory, { lens: firstLens });
    for (const f of filtered.findings) {
      expect(f.lens).toBe(firstLens);
    }
  });

  it("filters by status=pending (no decisions means pending)", async () => {
    const memory = await makeSeededMemory();
    const result = await listFindingsRequest(memory, { status: "pending" });
    expect(result.count).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.converted_to_eval).toBe(false);
    }
  });
});
