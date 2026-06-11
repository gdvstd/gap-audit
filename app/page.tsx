import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { getAdapterStatus } from "@/lib/runtime/adapter-status";
import { SeverityBadge } from "./_components/severity-badge";
import { GAP_LENSES, agentLabel, compactEvidence, humanizePatternName, lensMeta } from "./_components/gap-audit-copy";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { Severity } from "@/lib/contracts/enums";

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const SEV_BAR: Record<Severity, string> = {
  low: "bg-zinc-300",
  medium: "bg-amber-400",
  high: "bg-orange-500",
  critical: "bg-rose-600",
};

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

function sortFindings(a: AuditFinding, b: AuditFinding): number {
  const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  return d !== 0 ? d : b.confidence - a.confidence;
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
  const impacted = new Set(findings.map((f) => f.task_id));
  const failRate = percent(impacted.size, artifacts.length);
  const sev: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) sev[f.severity] += 1;

  const maxLensCount = Math.max(1, ...GAP_LENSES.map((l) => findings.filter((f) => f.lens === l.id).length));
  const lensRows = GAP_LENSES.map((lens) => {
    const count = findings.filter((f) => f.lens === lens.id).length;
    return { lens, count, share: percent(count, findings.length), width: Math.max(5, percent(count, maxLensCount)) };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);

  const agents = Array.from(new Set(artifacts.map((a) => a.agent_id).concat(findings.map((f) => f.agent_id)))).sort();
  const agentRows = agents.map((agentId) => {
    const af = findings.filter((f) => f.agent_id === agentId);
    const aa = artifacts.filter((a) => a.agent_id === agentId);
    const byLens = GAP_LENSES.map((lens) => ({ lens, count: af.filter((f) => f.lens === lens.id).length })).sort((a, b) => b.count - a.count);
    return {
      agentId, label: agentLabel(agentId), findings: af.length,
      topLens: byLens.find((i) => i.count > 0),
      affectedShare: percent(new Set(af.map((f) => f.task_id)).size, Math.max(1, aa.length)),
    };
  }).filter((r) => r.findings > 0).sort((a, b) => b.findings - a.findings);

  const topFindings = [...findings].sort(sortFindings).slice(0, 5);
  const topClusters = [...clusters].sort((a, b) => b.finding_count - a.finding_count).slice(0, 4);

  const cellCls = "lg:border-l lg:border-zinc-100 lg:pl-5 lg:first:border-l-0 lg:first:pl-0";

  return (
    <div className="space-y-6">
      {/* Hero: the thesis + the one number that matters */}
      <section className="border border-zinc-200 bg-white rounded-lg p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-950">Service Map Dashboard</h1>
            <p className="text-[15px] text-zinc-400 mt-1">Audit the gaps behind your AI agents&apos; resolved work</p>
          </div>
          <span className="shrink-0 text-[11px] text-zinc-400">
            {status.storage_mode} · {status.arize === "enabled" ? "Phoenix" : "Phoenix offline"}
          </span>
        </div>

        {/* metric strip under the title — balanced 5-up */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-6">
          <div className={cellCls}>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight text-rose-600">{impacted.size}</span>
              <span className="text-lg font-semibold tracking-tight text-rose-400">{failRate}%</span>
            </div>
            <div className="text-sm text-zinc-700 mt-1.5 leading-4">traces containing silent failures</div>
          </div>
          <div className={cellCls}>
            <div className="text-4xl font-semibold tracking-tight text-zinc-950">{artifacts.length}</div>
            <div className="text-sm text-zinc-700 mt-1.5">traces audited</div>
          </div>
          <div className={cellCls}>
            <div className="text-4xl font-semibold tracking-tight text-zinc-950">{findings.length}</div>
            <div className="text-sm text-zinc-700 mt-1.5">silent failures</div>
            <div className="mt-2">
              <div className="flex h-2 w-full overflow-hidden rounded bg-zinc-100">
                {(["critical", "high", "medium", "low"] as Severity[]).map((s) =>
                  sev[s] > 0 ? <div key={s} className={SEV_BAR[s]} style={{ width: percent(sev[s], findings.length) + "%" }} /> : null
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className={"h-1.5 w-1.5 rounded-sm " + SEV_BAR[s]} />{s} {sev[s]}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className={cellCls}>
            <div className="text-4xl font-semibold tracking-tight text-zinc-950">{clusters.length}</div>
            <div className="text-sm text-zinc-700 mt-1.5">recurring patterns</div>
          </div>
          <div className={cellCls}>
            <div className="text-4xl font-semibold tracking-tight text-zinc-950">{evalCases.length}</div>
            <div className="text-sm text-zinc-700 mt-1.5">regression tests</div>
          </div>
        </div>
      </section>

      {/* Where the gaps are: by failure type + by agent */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-zinc-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-zinc-900">By failure type</h2>
          <div className="mt-4 space-y-3.5">
            {lensRows.map(({ lens, count, share, width }) => (
              <Link key={lens.id} href={"/findings?lens=" + lens.id} className="grid grid-cols-1 lg:grid-cols-[13rem_1fr_3rem] gap-3 lg:items-center group">
                <p className="text-sm font-medium text-zinc-900 group-hover:text-blue-700">{lens.label}</p>
                <div className="h-2.5 rounded bg-zinc-100 overflow-hidden">
                  <div className={"h-full rounded " + lens.barClass} style={{ width: width + "%" }} />
                </div>
                <p className="text-sm text-zinc-500 lg:text-right">{count} <span className="text-zinc-400">· {share}%</span></p>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-zinc-900">By agent</h2>
          <div className="mt-4 space-y-3.5">
            {agentRows.map((row) => {
              const meta = row.topLens !== undefined ? row.topLens.lens : lensMeta("unknown");
              return (
                <div key={row.agentId} className="border-b border-zinc-100 last:border-0 pb-3.5 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900">{row.label}</p>
                    <span className="text-sm text-zinc-500">{row.findings}</span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-zinc-100 overflow-hidden">
                    <div className={"h-full rounded " + meta.barClass} style={{ width: Math.max(8, row.affectedShare) + "%" }} />
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">{row.affectedShare}% of traces · {row.topLens?.lens.label ?? "—"}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Most actionable + recurring */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900">Top gaps</h2>
            <Link href="/findings" className="text-sm text-zinc-500 hover:text-zinc-900">All gaps →</Link>
          </div>
          <div className="mt-3 divide-y divide-zinc-100">
            {topFindings.map((finding) => {
              const meta = lensMeta(finding.lens);
              return (
                <Link key={finding.finding_id} href={"/findings/" + finding.finding_id} className="block py-3.5 first:pt-0 hover:bg-zinc-50">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900">{meta.label}: {finding.failure_mode}</p>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <p className="text-sm text-zinc-500 mt-1.5 leading-5">{compactEvidence(finding, 1)}</p>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900">Recurring patterns</h2>
            <Link href="/clusters" className="text-sm text-zinc-500 hover:text-zinc-900">All patterns →</Link>
          </div>
          <div className="mt-3 space-y-2.5">
            {topClusters.map((cluster) => {
              const meta = lensMeta(cluster.dominant_lenses[0] ?? "unknown");
              return (
                <Link key={cluster.cluster_id} href={"/clusters/" + cluster.cluster_id} className={"block border rounded-lg p-3 hover:border-zinc-400 " + meta.borderClass + " " + meta.bgClass}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900">{humanizePatternName(cluster.pattern_name)}</p>
                    <span className="text-sm text-zinc-500">{cluster.finding_count}×</span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-1.5 leading-5">{agentLabel(cluster.agent_id)} · {cluster.recommended_action}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
