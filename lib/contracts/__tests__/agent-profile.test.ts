import { describe, it, expect } from "vitest";
import { validateAgentProfile } from "../agent-profile.js";

describe("validateAgentProfile", () => {
  const valid = {
    agent_id: "support_agent",
    agent_name: "Customer Support Agent",
    role: "Answer customer support questions",
    allowed_actions: ["draft_reply", "lookup_order"],
    restricted_actions: ["issue_refund_without_approval"],
    quality_principles: ["Check policy before denying refund"],
  };

  it("accepts a fully valid profile", () => {
    const result = validateAgentProfile(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agent_id).toBe("support_agent");
      expect(result.value.agent_name).toBe("Customer Support Agent");
    }
  });

  it("accepts empty arrays for actions and principles", () => {
    const result = validateAgentProfile({
      ...valid,
      allowed_actions: [],
      restricted_actions: [],
      quality_principles: [],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateAgentProfile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-object input", () => {
    const result = validateAgentProfile("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects missing agent_id", () => {
    const { agent_id: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("agent_id"))).toBe(true);
  });

  it("rejects empty agent_id", () => {
    const result = validateAgentProfile({ ...valid, agent_id: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("agent_id"))).toBe(true);
  });

  it("rejects missing agent_name", () => {
    const { agent_name: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("agent_name"))).toBe(true);
  });

  it("rejects missing role", () => {
    const { role: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("role"))).toBe(true);
  });

  it("rejects missing allowed_actions", () => {
    const { allowed_actions: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("allowed_actions"))).toBe(true);
  });

  it("rejects non-array allowed_actions", () => {
    const result = validateAgentProfile({ ...valid, allowed_actions: "not-array" });
    expect(result.ok).toBe(false);
  });

  it("rejects allowed_actions with non-string elements", () => {
    const result = validateAgentProfile({ ...valid, allowed_actions: [1, 2] });
    expect(result.ok).toBe(false);
  });

  it("rejects missing restricted_actions", () => {
    const { restricted_actions: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects missing quality_principles", () => {
    const { quality_principles: _, ...rest } = valid;
    const result = validateAgentProfile(rest);
    expect(result.ok).toBe(false);
  });

  it("accumulates multiple errors", () => {
    const result = validateAgentProfile({ agent_id: "", agent_name: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
