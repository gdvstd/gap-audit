import { describe, it, expect } from "vitest";
import { runRegressionEvals, matchExpectation } from "../run-evals.js";
import { demoCaseExpectations } from "../demo-eval-cases.js";
import { createDemoAdapter } from "../../agent/demo-adapter.js";
import type { ReasoningAdapter } from "../../agent/reasoning-adapter.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { AgentProfile } from "../../contracts/agent-profile.js";
import type { LensDefinition } from "../../agent/lens-prompts.js";
import type { EvalExpectation, EvalReport } from "../run-evals.js";
import type { AuditFinding } from "../../contracts/audit-finding.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A no-op adapter that always returns empty lens selection and no findings. */
function createNoOpAdapter(): ReasoningAdapter {
  return {
    name: "noop",
    enabled(): boolean {
      return true;
    },
    async selectLenses(_input: {
      artifact: AuditArtifact;
      profile: AgentProfile | null;
      lenses: LensDefinition[];
    }): Promise<{ lens_ids: string[] }> {
      return { lens_ids: [] };
    },
    async step(): Promise<{ kind: "final"; findings: [] }> {
      return { kind: "final", findings: [] };
    },
  };
}

// ─── EvalReport shape ─────────────────────────────────────────────────────────

describe("runRegressionEvals return shape", () => {
  it("returns an EvalReport with total, passed, failed, results array", async () => {
    const adapter = createNoOpAdapter();
    const expectations: EvalExpectation[] = [];
    const report = await runRegressionEvals({ adapter, expectations });

    expect(typeof report.total).toBe("number");
    expect(typeof report.passed).toBe("number");
    expect(typeof report.failed).toBe("number");
    expect(Array.isArray(report.results)).toBe(true);
  });

  it("returns total === 0 for empty expectations", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: [] });
    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  it("total equals passed + failed", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });
    expect(report.total).toBe(report.passed + report.failed);
  });

  it("results array has one entry per expectation", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });
    expect(report.results).toHaveLength(demoCaseExpectations.length);
  });

  it("each result has id, passed boolean, and reasons string array", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });
    for (const result of report.results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.passed).toBe("boolean");
      expect(Array.isArray(result.reasons)).toBe(true);
    }
  });
});

// ─── Negative test: no-op adapter causes all demo expectations to fail ─────────

describe("runRegressionEvals with no-op adapter (negative path)", () => {
  it("all demo expectations FAIL when adapter produces no findings", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });

    expect(report.failed).toBe(demoCaseExpectations.length);
    expect(report.passed).toBe(0);
  });

  it("every result.passed is false with no-op adapter", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });

    for (const result of report.results) {
      expect(result.passed).toBe(false);
    }
  });

  it("each failed result has at least one reason explaining the failure", async () => {
    const adapter = createNoOpAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });

    for (const result of report.results) {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});

// ─── Positive test: demo adapter satisfies all four demo expectations ─────────

describe("runRegressionEvals with demo adapter (positive path — all must pass)", () => {
  it("ALL four demo expectations pass with createDemoAdapter()", async () => {
    const adapter = createDemoAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });

    // Report every failure in the error message so debugging is easy
    const failedDetails = report.results
      .filter((r) => !r.passed)
      .map((r) => `${r.id}: ${r.reasons.join("; ")}`);

    expect(
      report.passed,
      `Expected all ${demoCaseExpectations.length} expectations to pass. Failures:\n${failedDetails.join("\n")}`
    ).toBe(demoCaseExpectations.length);
  });

  it("failed count is zero with demo adapter", async () => {
    const adapter = createDemoAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });
    expect(report.failed).toBe(0);
  });

  it("result IDs match the expectation IDs", async () => {
    const adapter = createDemoAdapter();
    const report = await runRegressionEvals({ adapter, expectations: demoCaseExpectations });
    const resultIds = report.results.map((r) => r.id);
    const expectationIds = demoCaseExpectations.map((e) => e.id);
    expect(resultIds).toEqual(expectationIds);
  });
});

// ─── Demo expectations cover all four required PRD §19 cases ──────────────────

describe("demoCaseExpectations coverage", () => {
  it("has exactly four demo case expectations", () => {
    expect(demoCaseExpectations).toHaveLength(4);
  });

  it("each expectation has required fields", () => {
    for (const expectation of demoCaseExpectations) {
      expect(typeof expectation.id).toBe("string");
      expect(expectation.id.length).toBeGreaterThan(0);
      expect(typeof expectation.description).toBe("string");
      expect(typeof expectation.agent_id).toBe("string");
      expect(Array.isArray(expectation.expect_failure_modes)).toBe(true);
      expect(expectation.expect_failure_modes.length).toBeGreaterThan(0);
      expect(typeof expectation.expect_lens).toBe("string");
      expect(["low", "medium", "high", "critical"]).toContain(expectation.expect_min_severity);
    }
  });

  it("includes the Evidence-Output Contradiction case (agent-support-01)", () => {
    const found = demoCaseExpectations.find(
      (e) =>
        e.agent_id === "agent-support-01" &&
        e.expect_failure_modes.some((fm) =>
          fm.toLowerCase().includes("evidence-output")
        )
    );
    expect(found).toBeDefined();
  });

  it("includes the Trust-Damaging Retention case (agent-recruiting-01)", () => {
    const found = demoCaseExpectations.find(
      (e) =>
        e.agent_id === "agent-recruiting-01" &&
        e.expect_failure_modes.some((fm) =>
          fm.toLowerCase().includes("trust-damaging retention")
        )
    );
    expect(found).toBeDefined();
  });

  it("includes the Guardrail Friction case (agent-support-01)", () => {
    const found = demoCaseExpectations.find(
      (e) => e.agent_id === "agent-support-01" && e.expect_lens === "operational-drift"
    );
    expect(found).toBeDefined();
  });

  it("includes the Latent Risk / False Resolution Drift case (agent-devops-01)", () => {
    const found = demoCaseExpectations.find(
      (e) =>
        e.agent_id === "agent-devops-01" &&
        (e.expect_lens === "operational-drift" || e.expect_lens === "resolved-but-not-served")
    );
    expect(found).toBeDefined();
  });

  it("Evidence-Output Contradiction expectation targets evidence-output lens at minimum high severity", () => {
    const found = demoCaseExpectations.find(
      (e) =>
        e.expect_lens === "context-neglect-gap" && e.agent_id === "agent-support-01"
    );
    expect(found).toBeDefined();
    expect(found!.expect_min_severity === "high" || found!.expect_min_severity === "critical").toBe(true);
  });

  it("Trust-Damaging Retention expectation targets trust-damaging-service lens at minimum high severity", () => {
    const found = demoCaseExpectations.find(
      (e) => e.expect_lens === "trust-damaging-service"
    );
    expect(found).toBeDefined();
    expect(found!.expect_min_severity === "high" || found!.expect_min_severity === "critical").toBe(true);
  });

  it("Guardrail Friction expectation has expect_min_severity of at least medium", () => {
    const found = demoCaseExpectations.find((e) => e.expect_lens === "operational-drift");
    expect(found).toBeDefined();
    const severity = found!.expect_min_severity;
    expect(["medium", "high", "critical"]).toContain(severity);
  });

  it("all expectation IDs are unique", () => {
    const ids = demoCaseExpectations.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ─── Control task forbid_for_task_ids enforcement ────────────────────────────

describe("forbid_for_task_ids enforcement", () => {
  it("expectation with forbid_for_task_ids passes when control tasks produce no findings (demo adapter)", async () => {
    const adapter = createDemoAdapter();
    // All demo expectations that have forbid_for_task_ids should still pass
    const forbidExpectations = demoCaseExpectations.filter(
      (e) => e.forbid_for_task_ids !== undefined && e.forbid_for_task_ids.length > 0
    );

    if (forbidExpectations.length === 0) {
      // If none have forbid_for_task_ids, the test trivially passes
      expect(true).toBe(true);
      return;
    }

    const report = await runRegressionEvals({ adapter, expectations: forbidExpectations });
    for (const result of report.results) {
      expect(result.passed).toBe(true);
    }
  });

  it("matchExpectation FAILS when a forbidden task_id has a finding in the findings list (pure function)", () => {
    // Directly test matchExpectation with a fabricated finding for a forbidden task_id
    const forbiddenTaskId = "task-ctrl-support-001";

    const expectation: EvalExpectation = {
      id: "forbid-pure-test",
      description: "test forbid_for_task_ids check",
      agent_id: "agent-support-01",
      expect_failure_modes: ["Evidence-Output Contradiction"],
      expect_min_severity: "high",
      expect_lens: "context-neglect-gap",
      forbid_for_task_ids: [forbiddenTaskId],
    };

    // One matching positive finding + one finding from the forbidden task
    const findings: AuditFinding[] = [
      {
        finding_id: "f-positive",
        task_id: "task-refund-001",
        agent_id: "agent-support-01",
        lens: "context-neglect-gap",
        failure_mode: "Evidence-Output Contradiction",
        severity: "high",
        confidence: 0.9,
        evidence: ["tool returned exception but output denied refund"],
        evidence_keywords: ["exception", "refund"],
        recommended_action: "Review",
        human_review_required: true,
        converted_to_eval: false,
        created_at: "2026-05-28T00:00:00Z",
        updated_at: "2026-05-28T00:00:00Z",
      },
      {
        // This finding comes from the forbidden control task — should cause failure
        finding_id: "f-forbidden",
        task_id: forbiddenTaskId,
        agent_id: "agent-support-01",
        lens: "context-neglect-gap",
        failure_mode: "Evidence-Output Contradiction",
        severity: "high",
        confidence: 0.8,
        evidence: ["unexpected finding on control task"],
        evidence_keywords: ["control"],
        recommended_action: "Investigate",
        human_review_required: false,
        converted_to_eval: false,
        created_at: "2026-05-28T00:00:00Z",
        updated_at: "2026-05-28T00:00:00Z",
      },
    ];

    const result = matchExpectation(expectation, findings);

    expect(result.passed).toBe(false);
    // Reasons should mention the forbidden task
    const hasForbidReason = result.reasons.some(
      (r) => r.toLowerCase().includes("forbid") || r.toLowerCase().includes(forbiddenTaskId)
    );
    expect(hasForbidReason).toBe(true);
  });

  it("matchExpectation PASSES when forbidden task has no findings and positive case matches", () => {
    const forbiddenTaskId = "task-ctrl-support-001";

    const expectation: EvalExpectation = {
      id: "forbid-pass-pure-test",
      description: "forbid check passes when no finding for control task",
      agent_id: "agent-support-01",
      expect_failure_modes: ["Evidence-Output Contradiction"],
      expect_min_severity: "high",
      expect_lens: "context-neglect-gap",
      forbid_for_task_ids: [forbiddenTaskId],
    };

    const findings: AuditFinding[] = [
      {
        finding_id: "f-positive",
        task_id: "task-refund-001",
        agent_id: "agent-support-01",
        lens: "context-neglect-gap",
        failure_mode: "Evidence-Output Contradiction",
        severity: "high",
        confidence: 0.9,
        evidence: ["tool returned exception but output denied refund"],
        evidence_keywords: ["exception", "refund"],
        recommended_action: "Review",
        human_review_required: true,
        converted_to_eval: false,
        created_at: "2026-05-28T00:00:00Z",
        updated_at: "2026-05-28T00:00:00Z",
      },
      // No finding for forbiddenTaskId
    ];

    const result = matchExpectation(expectation, findings);
    expect(result.passed).toBe(true);
  });
});

// ─── Per-expectation matcher logic (pure-function unit tests) ─────────────────

describe("matchExpectationToFindings pure logic", () => {
  it("matches when failure_mode contains the expected substring (case-insensitive)", async () => {
    // Use a single-expectation run with demo adapter to indirectly verify matching logic
    const adapter = createDemoAdapter();
    const singleExpectation: EvalExpectation[] = [
      {
        id: "evidence-output-test",
        description: "Evidence-Output Contradiction case",
        agent_id: "agent-support-01",
        expect_failure_modes: ["evidence-output contradiction"], // lowercase — must still match
        expect_min_severity: "high",
        expect_lens: "context-neglect-gap",
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(true);
  });

  it("fails when expect_lens does not match any finding (even if failure_mode matches)", async () => {
    const adapter = createDemoAdapter();

    // Ask for the right failure_mode but wrong lens — should not pass
    const singleExpectation: EvalExpectation[] = [
      {
        id: "wrong-lens-test",
        description: "Wrong lens specified",
        agent_id: "agent-support-01",
        expect_failure_modes: ["Evidence-Output Contradiction"],
        expect_min_severity: "high",
        expect_lens: "trust-damaging-service", // WRONG lens
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(false);
  });

  it("fails when expect_min_severity is higher than what was found", async () => {
    const adapter = createDemoAdapter();

    // Evidence-output produces "high" — asking for "critical" minimum should fail
    const singleExpectation: EvalExpectation[] = [
      {
        id: "severity-too-high-test",
        description: "Critical severity requirement fails against high finding",
        agent_id: "agent-support-01",
        expect_failure_modes: ["Evidence-Output Contradiction"],
        expect_min_severity: "critical", // Demo produces "high", not "critical"
        expect_lens: "context-neglect-gap",
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(false);
  });

  it("passes when finding severity exactly equals the expected minimum", async () => {
    const adapter = createDemoAdapter();

    // Evidence-output produces "high" — asking for "high" minimum should pass
    const singleExpectation: EvalExpectation[] = [
      {
        id: "severity-exact-match-test",
        description: "Exact severity match",
        agent_id: "agent-support-01",
        expect_failure_modes: ["Evidence-Output Contradiction"],
        expect_min_severity: "high",
        expect_lens: "context-neglect-gap",
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(true);
  });

  it("passes when finding severity exceeds the expected minimum (medium >= low)", async () => {
    const adapter = createDemoAdapter();

    // Ask for "low" minimum — demo produces "high" which is above "low" — should pass
    const singleExpectation: EvalExpectation[] = [
      {
        id: "severity-above-minimum-test",
        description: "Severity above minimum",
        agent_id: "agent-support-01",
        expect_failure_modes: ["Evidence-Output Contradiction"],
        expect_min_severity: "low",
        expect_lens: "context-neglect-gap",
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(true);
  });

  it("fails when no findings exist for the expected agent_id", async () => {
    const adapter = createNoOpAdapter();

    const singleExpectation: EvalExpectation[] = [
      {
        id: "no-findings-test",
        description: "No findings for agent",
        agent_id: "agent-support-01",
        expect_failure_modes: ["Evidence-Output Contradiction"],
        expect_min_severity: "high",
        expect_lens: "context-neglect-gap",
      },
    ];

    const report = await runRegressionEvals({ adapter, expectations: singleExpectation });
    expect(report.results[0]?.passed).toBe(false);
  });
});

// ─── EvalReport integrity ──────────────────────────────────────────────────────

describe("EvalReport integrity", () => {
  it("uses the default demoCaseExpectations when expectations is not provided", async () => {
    const adapter = createDemoAdapter();
    // No expectations parameter — should default to demoCaseExpectations
    const report = await runRegressionEvals({ adapter });
    expect(report.total).toBe(demoCaseExpectations.length);
  });

  it("demo adapter: passed + failed sums to total", async () => {
    const adapter = createDemoAdapter();
    const report: EvalReport = await runRegressionEvals({ adapter });
    expect(report.passed + report.failed).toBe(report.total);
  });

  it("result reasons are non-empty for passed results too (summary reason present)", async () => {
    const adapter = createDemoAdapter();
    const report = await runRegressionEvals({ adapter });
    const passedResults = report.results.filter((r) => r.passed);
    for (const result of passedResults) {
      // Passed results should still have a reason explaining why they passed
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});
