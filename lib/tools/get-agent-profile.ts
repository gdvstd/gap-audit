import type { AgentProfile } from "../contracts/agent-profile.js";
import { isObject, isString } from "../contracts/result.js";
import type { Tool, ToolResult } from "./types.js";

type GetAgentProfileResult = { profile: AgentProfile | null };

export const getAgentProfileTool: Tool<GetAgentProfileResult> = {
  name: "get_agent_profile",
  description:
    "Retrieve an AgentProfile by agent_id. Returns null if no profile is found. Exposes quality_principles, allowed_actions, and restricted_actions so the agent can judge against the actor's declared standards.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent_id of the profile to retrieve." },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<GetAgentProfileResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const agent_id = input["agent_id"];
    if (!isString(agent_id) || agent_id.length === 0) {
      return { ok: false, error: "agent_id must be a non-empty string" };
    }
    const profile = await ctx.memory.getAgentProfile(agent_id);
    return { ok: true, data: { profile } };
  },
};
