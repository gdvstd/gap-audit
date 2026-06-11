import { randomUUID } from "node:crypto";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { RegressionEvalCase } from "../contracts/regression-eval-case.js";
import { validateRegressionEvalCase } from "../contracts/regression-eval-case.js";
import { applyTemplate } from "./templates.js";

export function generateRegressionEvalCase(input: {
  finding: AuditFinding;
  artifact: AuditArtifact;
  now?: () => Date;
  idFactory?: () => string;
}): RegressionEvalCase {
  const { finding, artifact, now, idFactory } = input;
  const makeId = idFactory ?? (() => randomUUID());
  const makeDate = now ?? (() => new Date());

  const templatePartial = applyTemplate(finding, artifact);

  const evalCase: RegressionEvalCase = {
    eval_id: makeId(),
    source_finding_id: finding.finding_id,
    agent_id: finding.agent_id,
    input: artifact.user_input_summary,
    expected_behavior: templatePartial.expected_behavior ?? [],
    failure_mode_guarded: finding.failure_mode,
    created_at: makeDate().toISOString(),
  };

  if (
    templatePartial.required_evidence_usage !== undefined &&
    templatePartial.required_evidence_usage.length > 0
  ) {
    evalCase.required_evidence_usage = templatePartial.required_evidence_usage;
  }

  if (
    templatePartial.prohibited_patterns !== undefined &&
    templatePartial.prohibited_patterns.length > 0
  ) {
    evalCase.prohibited_patterns = templatePartial.prohibited_patterns;
  }

  if (
    templatePartial.privacy_constraints !== undefined &&
    templatePartial.privacy_constraints.length > 0
  ) {
    evalCase.privacy_constraints = templatePartial.privacy_constraints;
  }

  const validation = validateRegressionEvalCase(evalCase);
  if (!validation.ok) {
    throw new Error(
      `generateRegressionEvalCase produced an invalid eval case: ${validation.errors.join("; ")}`
    );
  }

  return evalCase;
}
