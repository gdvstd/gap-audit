import { describe, it, expect, beforeEach } from "vitest";
import { createToolRegistry } from "../registry.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { ToolContext } from "../types.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

function makeArtifact(task_id: string, agent_id = "agent-1"): AuditArtifact {
  return {
    task_id,
    agent_id,
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "test input",
    declared_goal: "test goal",
    final_output_summary: "test output",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

const EXPECTED_TOOL_NAMES = [
  "get_artifact",
  "get_agent_profile",
  "search_findings_history",
  "find_similar_findings",
  "aggregate_guardrail_events",
  "extract_conversation_signals",
  "inspect_handoff_quality",
  "aggregate_service_outcomes",
];

describe("createToolRegistry", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("returns an object with schemas, list, and dispatch", () => {
    const registry = createToolRegistry(ctx);
    expect(typeof registry.schemas).toBe("object");
    expect(typeof registry.list).toBe("function");
    expect(typeof registry.dispatch).toBe("function");
  });

  it("schemas contains all tools", () => {
    const registry = createToolRegistry(ctx);
    const names = registry.schemas.map((s) => s.name);
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("list() returns same schemas as schemas property", () => {
    const registry = createToolRegistry(ctx);
    expect(registry.list()).toEqual(registry.schemas);
  });

  it("schemas length equals expected tool count", () => {
    const registry = createToolRegistry(ctx);
    expect(registry.schemas).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it("each schema has name, description, and inputSchema", () => {
    const registry = createToolRegistry(ctx);
    for (const schema of registry.schemas) {
      expect(typeof schema.name).toBe("string");
      expect(schema.name.length).toBeGreaterThan(0);
      expect(typeof schema.description).toBe("string");
      expect(schema.description.length).toBeGreaterThan(0);
      expect(schema.inputSchema.type).toBe("object");
    }
  });

  it("dispatch returns ok:false for unknown tool name", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "unknown_tool", input: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown tool");
      expect(result.error).toContain("unknown_tool");
    }
  });

  it("dispatch: get_artifact resolves correctly", async () => {
    await ctx.memory.saveArtifacts([makeArtifact("task-1")]);
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "get_artifact", input: { task_id: "task-1" } });
    expect(result.ok).toBe(true);
  });

  it("dispatch: get_agent_profile resolves correctly", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "get_agent_profile", input: { agent_id: "agent-1" } });
    expect(result.ok).toBe(true);
  });

  it("dispatch: search_findings_history resolves correctly", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "search_findings_history", input: { agent_id: "agent-1" } });
    expect(result.ok).toBe(true);
  });

  it("dispatch: find_similar_findings resolves correctly", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "find_similar_findings",
      input: { agent_id: "agent-1", evidence_keywords: ["test"] },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatch: aggregate_guardrail_events resolves correctly", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "aggregate_guardrail_events",
      input: { agent_id: "agent-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatch: extract_conversation_signals resolves correctly", async () => {
    await ctx.memory.saveArtifacts([makeArtifact("task-1")]);
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "extract_conversation_signals",
      input: { task_id: "task-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatch: inspect_handoff_quality resolves correctly", async () => {
    await ctx.memory.saveArtifacts([makeArtifact("task-1")]);
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "inspect_handoff_quality",
      input: { task_id: "task-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatch: aggregate_service_outcomes resolves correctly", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "aggregate_service_outcomes",
      input: { agent_id: "agent-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatch: detect_sensitive_entities returns ok:false as unknown tool (removed from registry)", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({
      tool: "detect_sensitive_entities",
      input: { text: "hello world" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unknown tool: detect_sensitive_entities");
    }
  });

  it("dispatch propagates tool validation errors as ok:false", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "get_artifact", input: { task_id: "" } });
    expect(result.ok).toBe(false);
  });

  it("dispatch handles empty tool name as unknown tool", async () => {
    const registry = createToolRegistry(ctx);
    const result = await registry.dispatch({ tool: "", input: {} });
    expect(result.ok).toBe(false);
  });
});
