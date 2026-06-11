/**
 * Regression eval harness for SilentOps.
 *
 * Runs the full audit pipeline (seeded artifacts + agent profiles) against any
 * ReasoningAdapter, then evaluates each EvalExpectation against the resulting
 * findings. Deterministic when using createDemoAdapter().
 */

import { runAudit } from "../agent/auditor.js";
import { createInMemoryAuditMemory } from "../audit-memory/in-memory.js";
import { allSeedArtifacts, agentProfiles } from "../seeds/index.js";
import type { ReasoningAdapter } from "../agent/reasoning-adapter.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { Severity } from "../contracts/enums.js";
import { demoCaseExpectations, type EvalExpectation } from "./demo-eval-cases.js";

export type { EvalExpectation } from "./demo-eval-cases.js";

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function meetsSeverity(actual: Severity, minimum: Severity): boolean {
  return SEVERITY_ORDER[actual] >= SEVERITY_ORDER[minimum];
}

// ─── Per-expectation matching ─────────────────────────────────────────────────

type MatchResult = {
  passed: boolean;
  reasons: string[];
};

/**
 * Evaluate a single EvalExpectation against the full set of audit findings.
 *
 * Pass conditions (ALL must hold):
 *   1. At least one finding for the expected agent_id matches an expected
 *      failure_mode (case-insensitive contains) AND the expected lens (exact),
 *      AND meets the minimum severity.
 *   2. No finding exists whose task_id is in forbid_for_task_ids.
 */
export function matchExpectation(
  expectation: EvalExpectation,
  findings: AuditFinding[]
): MatchResult {
  const reasons: string[] = [];

  // ── Forbid check ─────────────────────────────────────────────────────────
  const forbidSet =
    expectation.forbid_for_task_ids !== undefined &&
    expectation.forbid_for_task_ids.length > 0
      ? new Set(expectation.forbid_for_task_ids)
      : null;

  if (forbidSet !== null) {
    const forbidden = findings.filter((f) => forbidSet.has(f.task_id));
    for (const f of forbidden) {
      reasons.push(
        `Forbidden task_id '${f.task_id}' produced a finding (lens: ${f.lens}, failure_mode: ${f.failure_mode}).`
      );
    }
  }

  // ── Positive match check ──────────────────────────────────────────────────
  const agentFindings = findings.filter((f) => f.agent_id === expectation.agent_id);

  const matchingFinding = agentFindings.find((f) => {
    const lensMatch = f.lens === expectation.expect_lens;
    const failureModeMatch = expectation.expect_failure_modes.some((fm) =>
      f.failure_mode.toLowerCase().includes(fm.toLowerCase())
    );
    const severityMatch = meetsSeverity(f.severity, expectation.expect_min_severity);
    return lensMatch && failureModeMatch && severityMatch;
  });

  if (matchingFinding === undefined) {
    // Build a helpful diagnostic message
    const agentLensFindings = agentFindings.filter((f) => f.lens === expectation.expect_lens);
    const totalAgentFindings = agentFindings.length;

    if (totalAgentFindings === 0) {
      reasons.push(
        `No findings produced for agent_id '${expectation.agent_id}'. Expected lens '${expectation.expect_lens}' to fire with failure_mode matching one of: [${expectation.expect_failure_modes.join(", ")}] at severity >= ${expectation.expect_min_severity}.`
      );
    } else if (agentLensFindings.length === 0) {
      const foundLenses = [...new Set(agentFindings.map((f) => f.lens))].join(", ");
      reasons.push(
        `Found ${totalAgentFindings} finding(s) for agent '${expectation.agent_id}' but none with lens '${expectation.expect_lens}'. Lenses found: [${foundLenses}].`
      );
    } else {
      // Lens matches but failure_mode or severity doesn't
      const failureModeDetails = agentLensFindings
        .map((f) => `failure_mode='${f.failure_mode}' severity='${f.severity}'`)
        .join("; ");
      reasons.push(
        `Found ${agentLensFindings.length} finding(s) for lens '${expectation.expect_lens}' but none match failure_mode [${expectation.expect_failure_modes.join(", ")}] at severity >= ${expectation.expect_min_severity}. Found: ${failureModeDetails}.`
      );
    }
  } else {
    reasons.push(
      `Matched finding (lens: ${matchingFinding.lens}, failure_mode: '${matchingFinding.failure_mode}', severity: ${matchingFinding.severity}).`
    );
  }

  const hasForbidViolation = reasons.some(
    (r) => r.startsWith("Forbidden")
  );
  const passed = matchingFinding !== undefined && !hasForbidViolation;

  return { passed, reasons };
}

// ─── EvalReport ───────────────────────────────────────────────────────────────

export type EvalReport = {
  total: number;
  passed: number;
  failed: number;
  results: {
    id: string;
    passed: boolean;
    reasons: string[];
  }[];
};

// ─── runRegressionEvals ───────────────────────────────────────────────────────

/**
 * Run the full seeded audit against the provided ReasoningAdapter, then
 * evaluate each EvalExpectation against the resulting findings.
 *
 * @param input.adapter - Any ReasoningAdapter (demo, Gemini, etc.)
 * @param input.expectations - Expectations to evaluate; defaults to demoCaseExpectations
 * @returns EvalReport with per-expectation pass/fail results
 */
export async function runRegressionEvals(input: {
  adapter: ReasoningAdapter;
  expectations?: EvalExpectation[];
}): Promise<EvalReport> {
  const { adapter } = input;
  const expectations = input.expectations ?? demoCaseExpectations;

  // Build a fresh in-memory store and seed it
  const memory = createInMemoryAuditMemory();
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);

  // Run the full audit pipeline
  await runAudit({ artifacts: allSeedArtifacts, adapter, memory });

  // Retrieve all findings produced
  const findings = await memory.listFindings();

  // Evaluate each expectation
  const results: EvalReport["results"] = expectations.map((expectation) => {
    const { passed, reasons } = matchExpectation(expectation, findings);
    return { id: expectation.id, passed, reasons };
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    total: expectations.length,
    passed,
    failed,
    results,
  };
}
