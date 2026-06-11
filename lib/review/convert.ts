import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { RegressionEvalCase } from "../contracts/regression-eval-case.js";
import { generateRegressionEvalCase } from "../eval-generator/generator.js";

export async function convertFindingToEval(input: {
  finding_id: string;
  memory: AuditMemoryAdapter;
  artifactsById: Map<string, AuditArtifact>;
  now?: () => Date;
  idFactory?: () => string;
}): Promise<RegressionEvalCase> {
  const { finding_id, memory, artifactsById, now, idFactory } = input;
  const makeDate = now ?? (() => new Date());

  const allFindings = await memory.listFindings();
  const finding = allFindings.find((f) => f.finding_id === finding_id);
  if (finding === undefined) {
    throw new Error(`convertFindingToEval: finding_id '${finding_id}' not found`);
  }

  const decisions = await memory.listReviewDecisions({ finding_id });
  const hasConfirmed = decisions.some((d) => d.decision === "confirmed");
  if (!hasConfirmed) {
    throw new Error(`convertFindingToEval: finding '${finding_id}' requires at least one confirmed review decision`);
  }

  const artifact = artifactsById.get(finding.task_id);
  if (artifact === undefined) {
    throw new Error(`convertFindingToEval: artifact for task_id '${finding.task_id}' not found in artifactsById`);
  }

  const evalCase = idFactory !== undefined
    ? generateRegressionEvalCase({ finding, artifact, now: makeDate, idFactory })
    : generateRegressionEvalCase({ finding, artifact, now: makeDate });

  await memory.saveEvalCase(evalCase);

  const nowIso = makeDate().toISOString();
  await memory.updateFinding(finding_id, { converted_to_eval: true, updated_at: nowIso });

  return evalCase;
}
