import { describe, it, expect } from "vitest";
import { generateRegressionEvalCase } from "../generator.js";
import { validateRegressionEvalCase } from "../../contracts/regression-eval-case.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

const FIXED_DATE = new Date("2026-05-28T00:00:00Z");
const FIXED_NOW = () => FIXED_DATE;
let idCount = 0;
const FIXED_ID = () => `eval-${++idCount}`;

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    finding_id: "f-1",
    task_id: "task-1",
    agent_id: "agent-support-01",
    lens: "evidence-output",
    failure_mode: "Evidence-Output Contradiction",
    severity: "critical",
    confidence: 0.85,
    evidence: ["tool returned fact X but output denied it"],
    evidence_keywords: ["tool", "returned", "fact"],
    recommended_action: "Re-examine retrieved evidence",
    human_review_required: true,
    converted_to_eval: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<AuditArtifact> = {}): AuditArtifact {
  return {
    task_id: "task-1",
    agent_id: "agent-support-01",
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "Customer requested a refund for a recent purchase.",
    declared_goal: "Process refund request",
    final_output_summary: "Refund denied. Customer does not qualify.",
    tool_facts: [
      { tool: "refund-policy-lookup", status: "success", fact: "Enterprise accounts qualify for exceptions." },
    ],
    agent_status: "resolved",
    actions_taken: [{ type: "reply-to-customer", visibility: "external", reversible: false }],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

describe("generateRegressionEvalCase", () => {
  it("returns a valid RegressionEvalCase for evidence-output finding", () => {
    const finding = makeFinding({ lens: "evidence-output", failure_mode: "Evidence-Output Contradiction" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const validation = validateRegressionEvalCase(result);
    expect(validation.ok).toBe(true);
  });

  it("evidence-output: expected_behavior includes 'use retrieved tool facts'", () => {
    const finding = makeFinding({ lens: "evidence-output" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.expected_behavior.some((b) => b.includes("retrieved tool facts"))).toBe(true);
  });

  it("evidence-output: required_evidence_usage lists tool names", () => {
    const finding = makeFinding({ lens: "evidence-output" });
    const artifact = makeArtifact({
      tool_facts: [
        { tool: "refund-policy-lookup", status: "success", fact: "Enterprise accounts qualify." },
        { tool: "account-lookup", status: "success", fact: "Account is active." },
      ],
    });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.required_evidence_usage).toContain("refund-policy-lookup");
    expect(result.required_evidence_usage).toContain("account-lookup");
  });

  it("evidence-output: prohibited_patterns includes denial and omit patterns", () => {
    const finding = makeFinding({ lens: "evidence-output" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.prohibited_patterns).toBeDefined();
    const patterns = result.prohibited_patterns ?? [];
    expect(patterns.some((p) => p.includes("omit"))).toBe(true);
    expect(patterns.some((p) => p.includes("deny"))).toBe(true);
  });

  it("returns a valid RegressionEvalCase for false-success finding", () => {
    const finding = makeFinding({ lens: "false-success", failure_mode: "False Success" });
    const artifact = makeArtifact({
      verification_artifacts: [{ type: "metric-recovery", status: "missing", summary: "not checked" }],
    });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const validation = validateRegressionEvalCase(result);
    expect(validation.ok).toBe(true);
  });

  it("false-success: expected_behavior includes 'verify task completion'", () => {
    const finding = makeFinding({ lens: "false-success" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.expected_behavior.some((b) => b.includes("verify"))).toBe(true);
  });

  it("false-success: prohibited_patterns includes 'mark status resolved without verification'", () => {
    const finding = makeFinding({ lens: "false-success" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const patterns = result.prohibited_patterns ?? [];
    expect(patterns.some((p) => p.includes("resolved"))).toBe(true);
  });

  it("returns a valid RegressionEvalCase for trust-damaging-service finding", () => {
    const finding = makeFinding({ lens: "trust-damaging-service", failure_mode: "Trust-Damaging Retention" });
    const artifact = makeArtifact({ sensitive_entity_types: ["phone_number", "salary"] });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const validation = validateRegressionEvalCase(result);
    expect(validation.ok).toBe(true);
  });

  it("trust-damaging-service: privacy_constraints describes trust-sensitive retention", () => {
    const finding = makeFinding({ lens: "trust-damaging-service" });
    const artifact = makeArtifact({ sensitive_entity_types: ["phone_number", "salary"] });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const constraints = result.privacy_constraints ?? [];
    expect(constraints.some((c) => c.includes("customer trust risk"))).toBe(true);
    expect(constraints.some((c) => c.includes("long-term or shared retention"))).toBe(true);
  });

  it("trust-damaging-service: prohibited_patterns reference risky stores", () => {
    const finding = makeFinding({ lens: "trust-damaging-service" });
    const artifact = makeArtifact({
      memory_writes: [
        {
          store: "eval-dataset-candidate-screening",
          content_summary: "Saved candidate screening context.",
          sensitive_entity_types: ["salary"],
          retention_risk: "critical",
        },
      ],
    });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const patterns = result.prohibited_patterns ?? [];
    expect(patterns.some((p) => p.includes("eval-dataset-candidate-screening"))).toBe(true);
    expect(patterns.some((p) => p.includes("retention policy"))).toBe(true);
  });

  it("returns a valid RegressionEvalCase for guardrail-friction finding", () => {
    const finding = makeFinding({ lens: "guardrail-friction", failure_mode: "customer-identifier-in-external-reply" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const validation = validateRegressionEvalCase(result);
    expect(validation.ok).toBe(true);
  });

  it("guardrail-friction: expected_behavior includes 'privacy boundary'", () => {
    const finding = makeFinding({ lens: "guardrail-friction", failure_mode: "customer-identifier-in-external-reply" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.expected_behavior.some((b) => b.includes("privacy boundary"))).toBe(true);
  });

  it("guardrail-friction: prohibited_patterns includes blocked action", () => {
    const finding = makeFinding({ lens: "guardrail-friction", failure_mode: "customer-identifier-in-external-reply" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const patterns = result.prohibited_patterns ?? [];
    expect(patterns.some((p) => p.includes("blocked action"))).toBe(true);
  });

  it("returns a valid RegressionEvalCase for latent-false-success-drift finding", () => {
    const finding = makeFinding({ lens: "latent-risk-pattern", failure_mode: "latent-false-success-drift" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const validation = validateRegressionEvalCase(result);
    expect(validation.ok).toBe(true);
  });

  it("latent-*: expected_behavior includes 'avoid repeating the dominant pattern'", () => {
    const finding = makeFinding({ lens: "latent-risk-pattern", failure_mode: "latent-false-success-drift" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.expected_behavior.some((b) => b.includes("repeating"))).toBe(true);
  });

  it("latent-*: prohibited_patterns includes the failure_mode_guarded", () => {
    const finding = makeFinding({ lens: "latent-risk-pattern", failure_mode: "latent-false-success-drift" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    const patterns = result.prohibited_patterns ?? [];
    expect(patterns.some((p) => p.includes("latent-false-success-drift"))).toBe(true);
  });

  it("throws on validation failure (e.g. missing agent_id)", () => {
    const finding = makeFinding({ agent_id: "" });
    const artifact = makeArtifact({ agent_id: "" });
    expect(() =>
      generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID })
    ).toThrow();
  });

  it("uses user_input_summary as the 'input' field", () => {
    const finding = makeFinding();
    const artifact = makeArtifact({ user_input_summary: "specific user input text" });
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.input).toBe("specific user input text");
  });

  it("source_finding_id matches the finding's finding_id", () => {
    const finding = makeFinding({ finding_id: "f-test-42" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.source_finding_id).toBe("f-test-42");
  });

  it("failure_mode_guarded matches the finding's failure_mode", () => {
    const finding = makeFinding({ failure_mode: "Evidence-Output Contradiction" });
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.failure_mode_guarded).toBe("Evidence-Output Contradiction");
  });

  it("created_at uses injected now", () => {
    const finding = makeFinding();
    const artifact = makeArtifact();
    const result = generateRegressionEvalCase({ finding, artifact, now: FIXED_NOW, idFactory: FIXED_ID });
    expect(result.created_at).toBe("2026-05-28T00:00:00.000Z");
  });
});
