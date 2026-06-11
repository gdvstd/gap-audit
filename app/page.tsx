import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { getAdapterStatus } from "@/lib/runtime/adapter-status";
import { MetricCard } from "./_components/metric-card";
import { SeverityBadge } from "./_components/severity-badge";
import { GAP_LENSES, agentLabel, compactEvidence, humanizePatternName, lensMeta } from "./_components/gap-audit-copy";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { Severity } from "@/lib/contracts/enums";

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function sortFindings(a: AuditFinding, b: AuditFinding): number {
  const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severityDiff !== 0) return severityDiff;
  return b.confidence - a.confidence;
}

export default async function OverviewPage() {
  const memory = await getMemory();

  const [artifacts, findings, clusters, evalCases] = await Promise.all([
    memory.listArtifacts(),
    memory.listFindings(),
    memory.listClusters(),
    memory.listEvalCases(),
  ]);

  const status = getAdapterStatus();
  const impactedTaskIds = new Set(findings.map((finding) => finding.task_id));
  const cleanArtifacts = artifacts.filter((artifact) => !impactedTaskIds.has(artifact.task_id)).length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const maxLensCount = Math.max(1, ...GAP_LENSES.map((lens) => findings.filter((finding) => finding.lens === lens.id).length));

  const lensRows = GAP_LENSES.map((lens) => {
    const count = findings.filter((finding) => finding.lens === lens.id).length;
    return { lens, count, share: percent(count, findings.length), width: Math.max(5, percent(count, maxLensCount)) };
  }).filter((row) => row.count > 0);

  const agents = Array.from(new Set(artifacts.map((artifact) => artifact.agent_id).concat(findings.map((finding) => finding.agent_id)))).sort();
  const agentRows = agents.map((agentId) => {
    const agentFindings = findings.filter((finding) => finding.agent_id === agentId);
    const agentArtifacts = artifacts.filter((artifact) => artifact.agent_id === agentId);
    const byLens = GAP_LENSES.map((lens) => ({ lens, count: agentFindings.filter((finding) => finding.lens === lens.id).length }))
      .sort((a, b) => b.count - a.count);
    const topLens = byLens.find((item) => item.count > 0);
    return {
      agentId,
      label: agentLabel(agentId),
      findings: agentFindings.length,
      artifacts: agentArtifacts.length,
      topLens,
      affectedShare: percent(new Set(agentFindings.map((finding) => finding.task_id)).size, Math.max(1, agentArtifacts.length)),
    };
  }).filter((row) => row.findings > 0).sort((a, b) => b.findings - a.findings);

  const topFindings = [...findings].sort(sortFindings).slice(0, 5);
  const topClusters = [...clusters].sort((a, b) => b.finding_count - a.finding_count).slice(0, 4);

  return (
    <div className="space-y-7">
      <section className="border border-zinc-200 bg-white rounded-lg p-5 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-wide text-zinc-500">GapAudit</p>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-zinc-950">
              Completed AI work that still failed the customer.
            </h1>
            <p className="mt-3 text-sm md:text-base text-zinc-600 leading-6">
              This dashboard shows where agents marked work resolved, safe, or handled while the trace still contains customer effort, missed context, unresolved operations, or trust risk.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-full sm:min-w-80 lg:min-w-96">
            <MetricCard title="Audited Traces" count={artifacts.length} subline="Phoenix trace artifacts" />
            <MetricCard title="Service Gaps" count={findings.length} subline={"high " + highCount + " / critical " + criticalCount} />
            <MetricCard title="Clean Controls" count={cleanArtifacts} subline="no finding after lens checks" />
            <MetricCard title="Patterns" count={clusters.length} subline={evalCases.length + " regression candidates"} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Service Gap Map</h2>
              <p className="text-sm text-zinc-500 mt-1">Problem types found across completed traces.</p>
            </div>
            <div className="text-right text-xs text-zinc-500">
              <div>{status.storage_mode} memory</div>
              <div>{status.arize === "enabled" ? "Phoenix connected" : "Phoenix offline"}</div>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {lensRows.map(({ lens, count, share, width }) => (
              <div key={lens.id} className="grid grid-cols-1 lg:grid-cols-[15rem_1fr] gap-3 lg:items-center">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900">{lens.label}</p>
                    <span className="text-sm font-semibold text-zinc-900">{count}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{share}% of findings</p>
                </div>
                <div>
                  <div className="h-3 rounded bg-zinc-100 overflow-hidden">
                    <div className={"h-full rounded " + lens.barClass} style={{ width: width + "%" }} />
                  </div>
                  <p className="text-xs text-zinc-600 mt-2 leading-5">{lens.customerSignal}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-zinc-900">Affected Agents</h2>
          <p className="text-sm text-zinc-500 mt-1">Where the gaps concentrate.</p>
          <div className="mt-5 space-y-4">
            {agentRows.map((row) => {
              const meta = row.topLens !== undefined ? row.topLens.lens : lensMeta("unknown");
              return (
                <div key={row.agentId} className="border-b border-zinc-100 last:border-0 pb-4 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{row.label}</p>
                      <p className="text-xs text-zinc-500">{row.agentId}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-900">{row.findings}</span>
                  </div>
                  <div className="mt-3 h-2 rounded bg-zinc-100 overflow-hidden">
                    <div className={"h-full rounded " + meta.barClass} style={{ width: Math.max(8, row.affectedShare) + "%" }} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">
                    {row.affectedShare}% of audited traces affected. Top gap: {row.topLens?.lens.label ?? "none"}.
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Most Actionable Gaps</h2>
              <p className="text-sm text-zinc-500 mt-1">High-confidence failures with customer-visible evidence.</p>
            </div>
            <Link href="/findings" className="text-sm text-zinc-700 hover:text-zinc-950">View all</Link>
          </div>
          <div className="mt-4 divide-y divide-zinc-100">
            {topFindings.map((finding) => {
              const meta = lensMeta(finding.lens);
              return (
                <Link key={finding.finding_id} href={"/findings/" + finding.finding_id} className="block py-4 first:pt-0 hover:bg-zinc-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{meta.label}: {finding.failure_mode}</p>
                      <p className="text-xs text-zinc-500 mt-1">{agentLabel(finding.agent_id)} / {finding.task_id}</p>
                    </div>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <p className="text-sm text-zinc-600 mt-2 leading-5">{compactEvidence(finding, 2)}</p>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Recurring Patterns</h2>
              <p className="text-sm text-zinc-500 mt-1">Clusters that should become workflow fixes or regression coverage.</p>
            </div>
            <Link href="/clusters" className="text-sm text-zinc-700 hover:text-zinc-950">View patterns</Link>
          </div>
          <div className="mt-4 space-y-3">
            {topClusters.map((cluster) => {
              const lens = cluster.dominant_lenses[0] ?? "unknown";
              const meta = lensMeta(lens);
              return (
                <div key={cluster.cluster_id} className={"border rounded-lg p-3 " + meta.borderClass + " " + meta.bgClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{humanizePatternName(cluster.pattern_name)}</p>
                      <p className="text-xs text-zinc-600 mt-1">{agentLabel(cluster.agent_id)} / {meta.label}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-900">{cluster.finding_count}</span>
                  </div>
                  <p className="text-xs text-zinc-700 mt-2 leading-5">{cluster.recommended_action}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
