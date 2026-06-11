import type { AuditFinding } from "../contracts/audit-finding.js";
import type { PatternCluster } from "../contracts/pattern-cluster.js";
import type { Severity } from "../contracts/enums.js";

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function isDefaultHidden(finding: AuditFinding): boolean {
  return (
    finding.severity === "low" &&
    finding.confidence < 0.6 &&
    finding.cluster_id === undefined
  );
}

export function rankReviewQueue(input: {
  findings: AuditFinding[];
  clusters: PatternCluster[];
  includeAll?: boolean;
}): AuditFinding[] {
  const { findings, clusters, includeAll } = input;

  const clusterById = new Map<string, PatternCluster>();
  for (const c of clusters) {
    clusterById.set(c.cluster_id, c);
  }

  const filtered = includeAll === true
    ? [...findings]
    : findings.filter((f) => !isDefaultHidden(f));

  return filtered.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) return severityDiff;

    const confidenceDiff = b.confidence - a.confidence;
    if (confidenceDiff !== 0) return confidenceDiff;

    const aRecurrence = a.cluster_id !== undefined ? (clusterById.get(a.cluster_id)?.finding_count ?? 0) : 0;
    const bRecurrence = b.cluster_id !== undefined ? (clusterById.get(b.cluster_id)?.finding_count ?? 0) : 0;
    const recurrenceDiff = bRecurrence - aRecurrence;
    if (recurrenceDiff !== 0) return recurrenceDiff;

    return b.updated_at.localeCompare(a.updated_at);
  });
}
