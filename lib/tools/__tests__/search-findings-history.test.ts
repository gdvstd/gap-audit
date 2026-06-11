import { describe, it, expect, beforeEach } from "vitest";
import { searchFindingsHistoryTool } from "../search-findings-history.js";
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
    evidence_keywords: ["some", "evidence"],
    recommended_action: "Review output",
    human_review_required: true,
    converted_to_eval: false,
    task_type: "customer-inquiry",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("searchFindingsHistoryTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name", () => {
    expect(searchFindingsHistoryTool.name).toBe("search_findings_history");
  });

  it("has a non-empty description", () => {
    expect(searchFindingsHistoryTool.description.length).toBeGreaterThan(0);
  });

  it("has a valid inputSchema with agent_id required", () => {
    expect(searchFindingsHistoryTool.inputSchema.type).toBe("object");
    expect(searchFindingsHistoryTool.inputSchema.required).toContain("agent_id");
  });

  it("returns ok:false when agent_id is missing", async () => {
    const result = await searchFindingsHistoryTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is empty string", async () => {
    const result = await searchFindingsHistoryTool.run({ agent_id: "" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is not a string", async () => {
    const result = await searchFindingsHistoryTool.run({ agent_id: 42 }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is null", async () => {
    const result = await searchFindingsHistoryTool.run(null, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns empty findings when no findings for agent", async () => {
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toEqual([]);
    }
  });

  it("returns all findings for the agent when no filter", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1"),
      makeFinding("f-2", "agent-1"),
      makeFinding("f-3", "agent-2"),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(2);
    }
  });

  it("filters by lens", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { lens: "evidence-output" }),
      makeFinding("f-2", "agent-1", { lens: "false-success" }),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1", lens: "false-success" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0]?.lens).toBe("false-success");
    }
  });

  it("filters by failure_mode", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { failure_mode: "Evidence-Output Contradiction" }),
      makeFinding("f-2", "agent-1", { failure_mode: "False Success" }),
    ]);
    const result = await searchFindingsHistoryTool.run({
      agent_id: "agent-1",
      failure_mode: "False Success",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0]?.failure_mode).toBe("False Success");
    }
  });

  it("filters by task_type", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { task_type: "customer-inquiry" }),
      makeFinding("f-2", "agent-1", { task_type: "incident-response" }),
    ]);
    const result = await searchFindingsHistoryTool.run({
      agent_id: "agent-1",
      task_type: "incident-response",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0]?.task_type).toBe("incident-response");
    }
  });

  it("sorts by created_at DESC then finding_id ASC", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-a", "agent-1", { created_at: "2026-05-01T00:00:00Z" }),
      makeFinding("f-b", "agent-1", { created_at: "2026-05-03T00:00:00Z" }),
      makeFinding("f-c", "agent-1", { created_at: "2026-05-03T00:00:00Z" }),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.data.findings.map((f) => f.finding_id);
      expect(ids).toEqual(["f-b", "f-c", "f-a"]);
    }
  });

  it("applies limit to results", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { created_at: "2026-05-01T00:00:00Z" }),
      makeFinding("f-2", "agent-1", { created_at: "2026-05-02T00:00:00Z" }),
      makeFinding("f-3", "agent-1", { created_at: "2026-05-03T00:00:00Z" }),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1", limit: 2 }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(2);
    }
  });

  it("ignores limit when limit is 0", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1"),
      makeFinding("f-2", "agent-1"),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1", limit: 0 }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(2);
    }
  });

  it("ignores limit when limit is negative", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1"),
      makeFinding("f-2", "agent-1"),
    ]);
    const result = await searchFindingsHistoryTool.run({ agent_id: "agent-1", limit: -1 }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(2);
    }
  });

  it("combines lens and failure_mode filters", async () => {
    await ctx.memory.saveFindings([
      makeFinding("f-1", "agent-1", { lens: "false-success", failure_mode: "False Success" }),
      makeFinding("f-2", "agent-1", { lens: "false-success", failure_mode: "Other" }),
      makeFinding("f-3", "agent-1", { lens: "evidence-output", failure_mode: "False Success" }),
    ]);
    const result = await searchFindingsHistoryTool.run({
      agent_id: "agent-1",
      lens: "false-success",
      failure_mode: "False Success",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0]?.finding_id).toBe("f-1");
    }
  });
});
