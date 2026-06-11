import { describe, it, expect } from "vitest";
import { buildLensPrompt } from "../build-lens-prompt.js";
import { getLensDefinition } from "../lens-prompts.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

const sampleArtifact: AuditArtifact = {
  task_id: "task-test-001",
  agent_id: "agent-test-01",
  timestamp: "2026-05-01T00:00:00Z",
  user_input_summary: "User asked for a refund",
  declared_goal: "Process refund request",
  final_output_summary: "Refund denied",
  tool_facts: [],
  agent_status: "resolved",
  actions_taken: [],
  sensitive_entity_types: [],
  memory_writes: [],
  guardrail_events: [],
};

describe("buildLensPrompt", () => {
  it("contains the lens id", () => {
    const lens = getLensDefinition("resolved-but-not-served")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain("resolved-but-not-served");
  });

  it("contains the lens core_question", () => {
    const lens = getLensDefinition("resolved-but-not-served")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain(lens.core_question);
  });

  it("contains the task_id under audit", () => {
    const lens = getLensDefinition("resolved-but-not-served")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain("task-test-001");
  });

  it("contains the agent_id under audit", () => {
    const lens = getLensDefinition("resolved-but-not-served")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain("agent-test-01");
  });

  it("contains the objective", () => {
    const lens = getLensDefinition("customer-effort-inflation")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain(lens.objective);
  });

  it("contains the severity_guidance", () => {
    const lens = getLensDefinition("trust-damaging-service")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain(lens.severity_guidance);
  });

  it("contains GapAudit overlap and canonical failure mode instructions", () => {
    const lens = getLensDefinition("operational-drift")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain("not mutually exclusive");
    expect(prompt).toContain("parallel drift finding");
    expect(prompt).toContain("canonical failure_mode");
  });

  it("pins output schema to the active lens id and numeric confidence", () => {
    const lens = getLensDefinition("context-neglect-gap")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(prompt).toContain('lens MUST be exactly "context-neglect-gap"');
    expect(prompt).toContain("confidence MUST be a JSON number");
    expect(prompt).toContain('severity MUST be one of: "low", "medium", "high", "critical"');
  });

  it("contains instruction to use only tool-returned facts", () => {
    const lens = getLensDefinition("context-neglect-gap")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    // Must contain some instruction about grounding in tool output
    const lower = prompt.toLowerCase();
    expect(
      lower.includes("tool") && (lower.includes("fact") || lower.includes("ground") || lower.includes("return"))
    ).toBe(true);
  });

  it("does NOT contain raw sensitive fields (user_input_summary content)", () => {
    const sensitiveArtifact: AuditArtifact = {
      ...sampleArtifact,
      task_id: "task-sensitive-001",
      agent_id: "agent-test-01",
      user_input_summary: "SUPERSECRETDATADONOTINCLUDE",
    };
    const lens = getLensDefinition("trust-damaging-service")!;
    const prompt = buildLensPrompt(lens, sensitiveArtifact);
    expect(prompt).not.toContain("SUPERSECRETDATADONOTINCLUDE");
  });

  it("returns a non-empty string", () => {
    const lens = getLensDefinition("operational-drift")!;
    const prompt = buildLensPrompt(lens, sampleArtifact);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("works for all 5 macro lens definitions", () => {
    const lensIds = [
      "resolved-but-not-served",
      "customer-effort-inflation",
      "trust-damaging-service",
      "context-neglect-gap",
      "operational-drift",
    ];
    for (const id of lensIds) {
      const lens = getLensDefinition(id)!;
      const prompt = buildLensPrompt(lens, sampleArtifact);
      expect(prompt.length).toBeGreaterThan(0);
    }
  });
});
