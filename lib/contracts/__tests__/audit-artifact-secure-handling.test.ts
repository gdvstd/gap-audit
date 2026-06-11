/**
 * Tests for the requires_secure_handling optional boolean field on AuditArtifact.
 */
import { describe, it, expect } from "vitest";
import { validateAuditArtifact } from "../audit-artifact.js";

function makeValidArtifact(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: "task-001",
    agent_id: "agent-001",
    timestamp: "2026-05-28T10:00:00Z",
    user_input_summary: "test input",
    declared_goal: "test goal",
    final_output_summary: "test output",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

describe("validateAuditArtifact — requires_secure_handling", () => {
  it("accepts artifact without requires_secure_handling (omitted is fine)", () => {
    const result = validateAuditArtifact(makeValidArtifact());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requires_secure_handling).toBeUndefined();
  });

  it("accepts requires_secure_handling: true", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requires_secure_handling).toBe(true);
  });

  it("accepts requires_secure_handling: false", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: false }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requires_secure_handling).toBe(false);
  });

  it("rejects requires_secure_handling as a string", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: "true" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("requires_secure_handling"))).toBe(true);
    }
  });

  it("rejects requires_secure_handling as a number", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: 1 }));
    expect(result.ok).toBe(false);
  });

  it("passes through the boolean value correctly when true", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requires_secure_handling).toBe(true);
  });

  it("passes through the boolean value correctly when false", () => {
    const result = validateAuditArtifact(makeValidArtifact({ requires_secure_handling: false }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requires_secure_handling).toBe(false);
  });
});
