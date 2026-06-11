import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { Severity } from "@/lib/contracts/enums";
import { rankReviewQueue } from "@/lib/review/queue";

const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;

type ReviewStatus = "confirmed" | "dismissed" | "pending" | "converted";

export type FindingsQuery = {
  agent_id?: string;
  lens?: string;
  severity?: Severity;
  status?: ReviewStatus;
};

function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITY_LEVELS as readonly string[]).includes(v);
}

function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === "string" && ["confirmed", "dismissed", "pending", "converted"].includes(v);
}

export function parseQuery(params: URLSearchParams): FindingsQuery {
  const result: FindingsQuery = {};
  const agent_id = params.get("agent_id");
  const lens = params.get("lens");
  const severity = params.get("severity");
  const status = params.get("status");

  if (agent_id !== null) result.agent_id = agent_id;
  if (lens !== null) result.lens = lens;
  if (isSeverity(severity)) result.severity = severity;
  if (isReviewStatus(status)) result.status = status;

  return result;
}

export async function listFindingsRequest(
  memory: AuditMemoryAdapter,
  query: FindingsQuery
): Promise<{ findings: AuditFinding[]; count: number }> {
  const { agent_id, severity, lens, status } = query;

  const allFindings = await memory.listFindings({
    ...(agent_id !== undefined ? { agent_id } : {}),
    ...(severity !== undefined ? { severity } : {}),
  });

  const allClusters = await memory.listClusters();
  const allDecisions = await memory.listReviewDecisions();

  const decisionsByFinding = new Map<string, string>();
  for (const d of allDecisions) {
    decisionsByFinding.set(d.finding_id, d.decision);
  }

  const getStatus = (finding: AuditFinding): ReviewStatus => {
    if (finding.converted_to_eval) return "converted";
    const decision = decisionsByFinding.get(finding.finding_id);
    if (decision === "confirmed") return "confirmed";
    if (decision === "dismissed") return "dismissed";
    return "pending";
  };

  let filtered = allFindings;

  if (lens !== undefined) {
    filtered = filtered.filter((f) => f.lens === lens);
  }

  if (status !== undefined) {
    filtered = filtered.filter((f) => getStatus(f) === status);
  }

  const ranked = rankReviewQueue({ findings: filtered, clusters: allClusters, includeAll: true });

  return { findings: ranked, count: ranked.length };
}
