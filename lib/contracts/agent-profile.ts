import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  requireString,
  requireStringArray,
} from "./result.js";

export type AgentProfile = {
  agent_id: string;
  agent_name: string;
  role: string;
  allowed_actions: string[];
  restricted_actions: string[];
  quality_principles: string[];
};

export function validateAgentProfile(input: unknown): ValidationResult<AgentProfile> {
  if (!isObject(input)) {
    return fail(["input must be a non-null object"]);
  }

  const errors: string[] = [];

  requireString(input, "agent_id", errors);
  requireString(input, "agent_name", errors);
  requireString(input, "role", errors);
  requireStringArray(input, "allowed_actions", errors);
  requireStringArray(input, "restricted_actions", errors);
  requireStringArray(input, "quality_principles", errors);

  if (errors.length > 0) return fail(errors);

  return ok({
    agent_id: input["agent_id"] as string,
    agent_name: input["agent_name"] as string,
    role: input["role"] as string,
    allowed_actions: input["allowed_actions"] as string[],
    restricted_actions: input["restricted_actions"] as string[],
    quality_principles: input["quality_principles"] as string[],
  });
}
