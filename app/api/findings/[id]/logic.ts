import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { PatternCluster } from "@/lib/contracts/pattern-cluster";
import type { ReviewDecision } from "@/lib/contracts/review-decision";
import type { RegressionEvalCase } from "@/lib/contracts/regression-eval-case";
import type { AuditArtifact } from "@/lib/contracts/audit-artifact";
import { allSeedArtifacts } from "@/lib/seeds/index";

export type FindingDetailResponse = {
  finding: AuditFinding;
  decisions: ReviewDecision[];
  cluster?: PatternCluster;
  artifact?: AuditArtifact;
  evalCase?: RegressionEvalCase;
};

export async function getFindingDetail(
  memory: AuditMemoryAdapter,
  finding_id: string
): Promise<{ ok: true; value: FindingDetailResponse } | { ok: false; status: number; error: string }> {
  const allFindings = await memory.listFindings();
  const finding = allFindings.find((candidate) => candidate.finding_id === finding_id);

  if (finding === undefined) {
    return { ok: false, status: 404, error: "finding '" + finding_id + "' not found" };
  }

  const decisions = await memory.listReviewDecisions({ finding_id });

  let cluster: PatternCluster | undefined;
  if (finding.cluster_id !== undefined) {
    const clusters = await memory.listClusters();
    cluster = clusters.find((candidate) => candidate.cluster_id === finding.cluster_id);
  }

  const artifact = (await memory.getArtifact(finding.task_id)) ?? allSeedArtifacts.find((candidate) => candidate.task_id === finding.task_id);

  let evalCase: RegressionEvalCase | undefined;
  if (finding.converted_to_eval) {
    const evalCases = await memory.listEvalCases({ source_finding_id: finding_id });
    evalCase = evalCases[0];
  }

  const response: FindingDetailResponse = { finding, decisions };
  if (cluster !== undefined) response.cluster = cluster;
  if (artifact !== undefined) response.artifact = artifact;
  if (evalCase !== undefined) response.evalCase = evalCase;

  return { ok: true, value: response };
}
