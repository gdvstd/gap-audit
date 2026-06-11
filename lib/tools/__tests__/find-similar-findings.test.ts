import { describe, it, expect, beforeEach } from "vitest";
import { findSimilarFindingsTool } from "../find-similar-findings.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { ToolContext } from "../types.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";

function makeFinding(
  finding_id: string,
  agent_id = "agent-1",
  overrides: Partial<AuditFinding> = {}
): AuditFinding {
  return {
    finding_id,
    task_id: `task-${finding_id}`,
    agent_id,
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity: "high",
    confidence: 0.85,
    evidence: ["some evidence"],
    evidence_keywords: ["refund", "policy", "denied"],
    recommended_action: "Review output",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("findSimilarFindingsTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name", () => {
    expect(findSimilarFindingsTool.name).toBe("find_similar_findings");
  });

  it("has a non-empty description", () => {
    expect(findSimilarFindingsTool.description.length).toBeGreaterThan(0);
  });

  it("has a valid inputSchema with agent_id required", () => {
    expect(findSimilarFindingsTool.inputSchema.type).toBe("object");
    expect(findSimilarFindingsTool.inputSchema.required).toContain("agent_id");
  });

  it("returns ok:false when agent_id is missing", async () => {
    const result = await findSimilarFindingsTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is empty string", async () => {
    const result = await findSimilarFindingsTool.run({ agent_id: "" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when neither evidence_keywords nor text is provided", async () => {
    const result = await findSimilarFindingsTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it("returns ok:false when input is null", async () => {
    const result = await findSimilarFindingsTool.run(null, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns empty findings when no findings for agent", async () => {
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund"],
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toEqual([]);
    }
  });

  it("ranks by jaccard similarity using evidence_keywords", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { evidence_keywords: ["refund", "policy", "denied"] }),
      makeFinding("f-2", "agent-1", { evidence_keywords: ["login", "timeout", "error"] }),
    ]);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund", "policy"],
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // f-1 should be more similar (shares 2/3 of keywords)
      expect(result.data.findings[0]?.finding_id).toBe("f-1");
    }
  });

  it("uses text to extract query keywords when evidence_keywords not given", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { evidence_keywords: ["refund", "policy", "denied"] }),
      makeFinding("f-2", "agent-1", { evidence_keywords: ["login", "error"] }),
    ]);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      text: "refund policy denied to customer",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings[0]?.finding_id).toBe("f-1");
    }
  });

  it("defaults limit to 5", async () => {
    const findings = Array.from({ length: 8 }, (_, i) =>
      makeFinding(`f-${i + 1}`, "agent-1", {
        evidence_keywords: ["refund", "policy"],
      })
    );
    await ctx.memory.saveFindings(findings);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund"],
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(5);
    }
  });

  it("respects custom limit", async () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding(`f-${i + 1}`, "agent-1", { evidence_keywords: ["refund"] })
    );
    await ctx.memory.saveFindings(findings);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund"],
      limit: 2,
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(2);
    }
  });

  it("tie-breaks by finding_id ASC when jaccard is equal", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-z", "agent-1", { evidence_keywords: ["refund", "policy"] }),
      makeFinding("f-a", "agent-1", { evidence_keywords: ["refund", "policy"] }),
      makeFinding("f-m", "agent-1", { evidence_keywords: ["refund", "policy"] }),
    ]);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund", "policy"],
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.data.findings.map((f) => f.finding_id);
      expect(ids[0]).toBe("f-a");
      expect(ids[1]).toBe("f-m");
      expect(ids[2]).toBe("f-z");
    }
  });

  it("does not return findings from other agents", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { evidence_keywords: ["refund", "policy"] }),
      makeFinding("f-2", "agent-2", { evidence_keywords: ["refund", "policy"] }),
    ]);
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund"],
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings.every((f) => f.agent_id === "agent-1")).toBe(true);
    }
  });

  it("prefers evidence_keywords over text when both given", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { evidence_keywords: ["refund", "policy", "denied"] }),
      makeFinding("f-2", "agent-1", { evidence_keywords: ["login", "timeout"] }),
    ]);
    // text contains "login" but evidence_keywords contains "refund" — should rank by evidence_keywords
    const result = await findSimilarFindingsTool.run({
      agent_id: "agent-1",
      evidence_keywords: ["refund", "policy", "denied"],
      text: "login timeout error occurred",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings[0]?.finding_id).toBe("f-1");
    }
  });
});
