import { describe, it, expect, beforeEach } from "vitest";
import { getAgentProfileTool } from "../get-agent-profile.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import type { ToolContext } from "../types.js";
import type { AgentProfile } from "../../contracts/agent-profile.js";

function makeProfile(agent_id: string): AgentProfile {
  return {
    agent_id,
    agent_name: `Agent ${agent_id}`,
    role: "support",
    allowed_actions: ["lookup"],
    restricted_actions: ["delete"],
    quality_principles: ["be accurate"],
  };
}

function makeCtx(): ToolContext {
  return { memory: createInMemoryAuditMemory() };
}

describe("getAgentProfileTool", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("has correct name", () => {
    expect(getAgentProfileTool.name).toBe("get_agent_profile");
  });

  it("has a non-empty description", () => {
    expect(getAgentProfileTool.description.length).toBeGreaterThan(0);
  });

  it("has a valid inputSchema with agent_id required", () => {
    expect(getAgentProfileTool.inputSchema.type).toBe("object");
    expect(getAgentProfileTool.inputSchema.required).toContain("agent_id");
  });

  it("returns ok with null profile when agent_id not found", async () => {
    const result = await getAgentProfileTool.run({ agent_id: "nonexistent" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profile).toBeNull();
    }
  });

  it("returns ok with profile when agent_id exists", async () => {
    await ctx.memory.saveAgentProfiles([makeProfile("agent-1")]);
    const result = await getAgentProfileTool.run({ agent_id: "agent-1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profile?.agent_id).toBe("agent-1");
    }
  });

  it("returns ok:false when agent_id is missing", async () => {
    const result = await getAgentProfileTool.run({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is empty string", async () => {
    const result = await getAgentProfileTool.run({ agent_id: "" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when agent_id is not a string", async () => {
    const result = await getAgentProfileTool.run({ agent_id: 123 }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is null", async () => {
    const result = await getAgentProfileTool.run(null, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when input is a string", async () => {
    const result = await getAgentProfileTool.run("agent-1", ctx);
    expect(result.ok).toBe(false);
  });
});
