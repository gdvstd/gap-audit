import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { PatternCluster } from "../contracts/pattern-cluster.js";
import type { Severity, Trend } from "../contracts/enums.js";
import { jaccard } from "./jaccard.js";
import { derivePatternName, toFailureModeTag } from "./pattern-name.js";
import { generateClusterId } from "./cluster-id.js";

export type ClusterRunInput = {
  memory: AuditMemoryAdapter;
  now?: () => Date;
  idFactory?: () => string;
};

export type ClusterRunResult = {
  cluster_count: number;
  updated_finding_count: number;
};

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxSeverity(severities: Severity[]): Severity {
  let max: Severity = "low";
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[max]) {
      max = s;
    }
  }
  return max;
}

type FindingGroup = {
  agent_id: string;
  lens: string;
  failure_mode_tag: string;
  task_type: string;
};

function groupKey(g: FindingGroup): string {
  return `${g.agent_id}|${g.lens}|${g.failure_mode_tag}|${g.task_type}`;
}

function findingGroupKey(f: AuditFinding): string {
  return groupKey({
    agent_id: f.agent_id,
    lens: f.lens,
    failure_mode_tag: toFailureModeTag(f.failure_mode),
    task_type: f.task_type ?? "unknown",
  });
}

type InternalCluster = {
  centroid: string[];
  findings: AuditFinding[];
};

function clusterFindings(findings: AuditFinding[]): InternalCluster[] {
  const sorted = [...findings].sort((a, b) => {
    const timeDiff = a.created_at.localeCompare(b.created_at);
    return timeDiff !== 0 ? timeDiff : a.finding_id.localeCompare(b.finding_id);
  });

  const clusters: InternalCluster[] = [];

  for (const finding of sorted) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < clusters.length; i++) {
      const score = jaccard(finding.evidence_keywords, clusters[i]!.centroid);
      if (score >= 0.6 && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const existing = clusters[bestIdx]!;
      existing.findings.push(finding);
      const newCentroid = Array.from(
        new Set([...existing.centroid, ...finding.evidence_keywords])
      );
      existing.centroid = newCentroid;
    } else {
      clusters.push({ centroid: [...finding.evidence_keywords], findings: [finding] });
    }
  }

  return clusters;
}

export async function runClusterer(input: ClusterRunInput): Promise<ClusterRunResult> {
  const { memory, now, idFactory } = input;
  const makeId = idFactory ?? generateClusterId;
  const makeDate = now ?? (() => new Date());

  const allFindings = await memory.listFindings();
  const priorClusters = await memory.listClusters();

  const priorClusterMap = new Map<string, PatternCluster>();
  for (const pc of priorClusters) {
    priorClusterMap.set(pc.cluster_id, pc);
  }

  const priorClustersByGroupKey = new Map<string, PatternCluster>();
  for (const pc of priorClusters) {
    const key = `${pc.agent_id}|${pc.dominant_lenses[0] ?? ""}|${pc.pattern_name.split(":")[0] ?? ""}|${pc.pattern_name.split(":")[1] ?? "unknown"}`;
    priorClustersByGroupKey.set(key, pc);
  }

  const groupedFindings = new Map<string, AuditFinding[]>();
  for (const f of allFindings) {
    const key = findingGroupKey(f);
    const existing = groupedFindings.get(key);
    if (existing !== undefined) {
      existing.push(f);
    } else {
      groupedFindings.set(key, [f]);
    }
  }

  const resultClusters: PatternCluster[] = [];
  let updatedFindingCount = 0;
  const nowIso = makeDate().toISOString();

  for (const [gKey, groupFindings] of groupedFindings) {
    const parts = gKey.split("|");
    const agent_id = parts[0] ?? "";
    const lens = parts[1] ?? "";
    const failure_mode_tag = parts[2] ?? "";
    const task_type = parts[3] ?? "unknown";

    const internalClusters = clusterFindings(groupFindings);

    for (const ic of internalClusters) {
      const memberFindings = ic.findings;

      const sortedMembers = [...memberFindings].sort((a, b) => {
        const timeDiff = a.created_at.localeCompare(b.created_at);
        return timeDiff !== 0 ? timeDiff : a.finding_id.localeCompare(b.finding_id);
      });

      const finding_ids = sortedMembers.map((f) => f.finding_id);
      const severity = maxSeverity(memberFindings.map((f) => f.severity));
      const pattern_name = derivePatternName(lens, memberFindings[0]?.failure_mode ?? failure_mode_tag, task_type);

      const highestSeverityFindings = memberFindings.filter(
        (f) => SEVERITY_RANK[f.severity] === SEVERITY_RANK[severity]
      );
      const recommended_action = highestSeverityFindings.sort(
        (a, b) => b.updated_at.localeCompare(a.updated_at)
      )[0]?.recommended_action ?? "";

      const min_created = sortedMembers[0]?.created_at ?? nowIso;
      const max_created = sortedMembers[sortedMembers.length - 1]?.created_at ?? nowIso;
      const time_window = `${min_created}/${max_created}`;

      const priorLookupKey = `${agent_id}|${lens}|${failure_mode_tag}|${task_type}`;
      const priorCluster = priorClustersByGroupKey.get(priorLookupKey);

      let cluster_id: string;
      let trend: Trend;

      if (priorCluster !== undefined) {
        const hasOverlap = finding_ids.some((id) => priorCluster.finding_ids.includes(id));
        if (hasOverlap) {
          cluster_id = priorCluster.cluster_id;
          trend = memberFindings.length > priorCluster.finding_count ? "increasing" : "stable";
        } else {
          cluster_id = makeId();
          trend = memberFindings.length === 1 ? "new" : "increasing";
        }
      } else {
        cluster_id = makeId();
        trend = memberFindings.length === 1 ? "new" : "increasing";
      }

      const cluster: PatternCluster = {
        cluster_id,
        agent_id,
        pattern_name,
        finding_count: finding_ids.length,
        time_window,
        dominant_lenses: [lens],
        severity,
        trend,
        recommended_action,
        finding_ids,
      };

      resultClusters.push(cluster);

      for (const f of memberFindings) {
        if (f.cluster_id !== cluster_id) {
          await memory.updateFinding(f.finding_id, { cluster_id, updated_at: nowIso });
          updatedFindingCount++;
        }
      }
    }
  }

  await memory.saveClusters(resultClusters);

  return {
    cluster_count: resultClusters.length,
    updated_finding_count: updatedFindingCount,
  };
}
