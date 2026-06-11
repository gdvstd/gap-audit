import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { PatternCluster } from "@/lib/contracts/pattern-cluster";

export type GapLensMeta = {
  id: string;
  label: string;
  shortLabel: string;
  problem: string;
  customerSignal: string;
  defaultAction: string;
  borderClass: string;
  bgClass: string;
  barClass: string;
  textClass: string;
};

export const GAP_LENSES: GapLensMeta[] = [
  {
    id: "context-neglect-gap",
    label: "Context Ignored",
    shortLabel: "Context",
    problem: "The agent had account, policy, or contract evidence that should have changed the answer, but closed the work against that context.",
    customerSignal: "Eligible customers get denied, sent backward, or asked to redo work the system already knows about.",
    defaultAction: "Force context reconciliation before denial, closure, or handoff.",
    borderClass: "border-sky-200",
    bgClass: "bg-sky-50",
    barClass: "bg-sky-600",
    textClass: "text-sky-900",
  },
  {
    id: "customer-effort-inflation",
    label: "Effort Shifted To Customer",
    shortLabel: "Effort",
    problem: "The agent made the customer carry unresolved work: repeat information, retry a failed self-service path, or come back later without an owner.",
    customerSignal: "Repeat contact, frustration, and escalation pressure rise even though the ticket looks resolved.",
    defaultAction: "Reuse known context, assign an owner, and stop self-service loops after repeated failure.",
    borderClass: "border-amber-200",
    bgClass: "bg-amber-50",
    barClass: "bg-amber-600",
    textClass: "text-amber-900",
  },
  {
    id: "trust-damaging-service",
    label: "Trust-Damaging Handling",
    shortLabel: "Trust",
    problem: "The agent solved the immediate task by retaining or sharing sensitive customer context beyond the service need.",
    customerSignal: "The interaction may appear complete, but the customer loses control over sensitive information.",
    defaultAction: "Block long-term or shared retention unless purpose, policy, and user-facing controls are present.",
    borderClass: "border-fuchsia-200",
    bgClass: "bg-fuchsia-50",
    barClass: "bg-fuchsia-600",
    textClass: "text-fuchsia-900",
  },
  {
    id: "resolved-but-not-served",
    label: "False Resolution",
    shortLabel: "False Resolution",
    problem: "The agent marked the work resolved while verification evidence still showed the underlying problem was active.",
    customerSignal: "Internal status says done, but customers or operators still experience the failure.",
    defaultAction: "Require outcome verification before resolved status can be written.",
    borderClass: "border-rose-200",
    bgClass: "bg-rose-50",
    barClass: "bg-rose-600",
    textClass: "text-rose-900",
  },
  {
    id: "operational-drift",
    label: "Recurring Operational Drift",
    shortLabel: "Drift",
    problem: "The same agent repeatedly shows service gaps, guardrail friction, or false-success behavior across completed traces.",
    customerSignal: "A one-off trace becomes a product or workflow pattern that will keep recurring.",
    defaultAction: "Treat the pattern as a workflow fix, prompt fix, escalation rule, or regression eval candidate.",
    borderClass: "border-emerald-200",
    bgClass: "bg-emerald-50",
    barClass: "bg-emerald-600",
    textClass: "text-emerald-900",
  },
];

const FALLBACK_LENS: GapLensMeta = {
  id: "unknown",
  label: "Service Gap",
  shortLabel: "Gap",
  problem: "The completed interaction contains evidence of customer or operational harm.",
  customerSignal: "The system status alone does not describe the service outcome.",
  defaultAction: "Review the evidence and update the workflow that allowed the gap.",
  borderClass: "border-zinc-200",
  bgClass: "bg-zinc-50",
  barClass: "bg-zinc-700",
  textClass: "text-zinc-900",
};

export function lensMeta(lens: string): GapLensMeta {
  return GAP_LENSES.find((item) => item.id === lens) ?? { ...FALLBACK_LENS, id: lens };
}

export function agentLabel(agentId: string): string {
  const labels: Record<string, string> = {
    "agent-support-01": "Support Agent",
    "agent-recruiting-01": "Recruiting Agent",
    "agent-devops-01": "Incident Agent",
  };
  return labels[agentId] ?? agentId;
}

// The audit agent's own identity (matches `name="GapAudit"` on the ADK agent). A finding
// describes the ACTOR agent it audited — never the auditor. If a stale/mislabeled record
// attributes a finding to the auditor (or has no agent at all), it must not render as a
// phantom agent in the dashboard. Real actor agents are unaffected.
const AUDITOR_IDENTITY = "GapAudit";

export function isAttributableAgent(agentId: string): boolean {
  const norm = agentId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm !== "" && norm !== AUDITOR_IDENTITY.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function humanizePatternName(patternName: string): string {
  const [mode, taskType] = patternName.split(":");
  const modeLabel = (mode ?? patternName)
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  if (taskType === undefined || taskType === "unknown") return modeLabel;
  const taskLabel = taskType.replace(/[_-]+/g, " ");
  return modeLabel + " in " + taskLabel;
}

export function firstEvidence(finding: Pick<AuditFinding, "evidence">): string {
  return finding.evidence[0] ?? "No evidence recorded.";
}

export function compactEvidence(finding: Pick<AuditFinding, "evidence">, max = 2): string {
  return finding.evidence.slice(0, max).join(" | ");
}

export function problemStatement(finding: Pick<AuditFinding, "lens" | "failure_mode">): string {
  const meta = lensMeta(finding.lens);
  return meta.label + ": " + finding.failure_mode;
}

export function clusterProblem(cluster: PatternCluster): string {
  const lens = cluster.dominant_lenses[0] ?? "unknown";
  return lensMeta(lens).label + " pattern";
}
