import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemory } from "@/lib/runtime/container";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { StatusPill } from "@/app/_components/status-pill";
import { agentLabel, firstEvidence, humanizePatternName, lensMeta } from "@/app/_components/gap-audit-copy";
import type { Trend } from "@/lib/contracts/enums";

type PageParams = Promise<{ cluster_id: string }>;

function trendToStatus(trend: Trend): "confirmed" | "missing_config" | "disabled" {
  if (trend === "new") return "confirmed";
  if (trend === "increasing") return "missing_config";
  return "disabled";
}

function trendCopy(trend: Trend, count: number): string {
  if (trend === "increasing") return `Increasing — this failure recurred across ${count} traces and is accelerating. Treat it as a workflow/prompt/policy fix, not ${count} separate tickets.`;
  if (trend === "new") return "Newly observed — first occurrence of this pattern. Watch whether it recurs.";
  return `Stable — recurring (${count} traces) but not accelerating. Still worth a systemic fix.`;
}

export default async function PatternDetailPage({ params }: { params: PageParams }) {
  const { cluster_id } = await params;
  const memory = await getMemory();
  const clusters = await memory.listClusters();
  const cluster = clusters.find((c) => c.cluster_id === cluster_id);
  if (cluster === undefined) notFound();

  const allFindings = await memory.listFindings();
  const members = allFindings
    .filter((f) => cluster.finding_ids.includes(f.finding_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const lens = cluster.dominant_lenses[0] ?? "unknown";
  const meta = lensMeta(lens);

  // Most common evidence keywords across the pattern's findings.
  const kwCounts = new Map<string, number>();
  for (const f of members) for (const k of f.evidence_keywords ?? []) kwCounts.set(k, (kwCounts.get(k) ?? 0) + 1);
  const topKeywords = [...kwCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const failureModes = Array.from(new Set(members.map((f) => f.failure_mode)));
  const convertedCount = members.filter((f) => f.converted_to_eval).length;
  const gapsHref = "/findings?agent_id=" + encodeURIComponent(cluster.agent_id) + "&lens=" + encodeURIComponent(lens);

  return (
    <div className="max-w-6xl space-y-5">
      <Link href="/clusters" className="text-sm text-zinc-500 hover:text-zinc-800">← All patterns</Link>

      <section className={"rounded-lg border bg-white p-5 " + meta.borderClass}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
          <SeverityBadge severity={cluster.severity} />
          <StatusPill status={trendToStatus(cluster.trend)} label={cluster.trend} />
          <span className="text-xs text-zinc-500">{cluster.finding_count} occurrences</span>
        </div>
        <p className="mt-4 text-xs uppercase tracking-wide text-zinc-500">Recurring pattern</p>
        <h1 className="mt-1 text-2xl font-semibold leading-8 text-zinc-950">{humanizePatternName(cluster.pattern_name)}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-700">{meta.problem}</p>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-zinc-500">Affected agent</p>
            <p className="mt-1 font-medium text-zinc-900">{agentLabel(cluster.agent_id)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Occurrences</p>
            <p className="mt-1 font-medium text-zinc-900">{cluster.finding_count}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Trend</p>
            <p className="mt-1 font-medium text-zinc-900">{cluster.trend}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Converted to evals</p>
            <p className="mt-1 font-medium text-zinc-900">{convertedCount} / {members.length}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Recommended action</p>
            <p className="mt-2 text-sm leading-6 text-emerald-950">{cluster.recommended_action || "No action recorded yet — confirm the findings to derive one."}</p>
            <Link href="/evals" className="mt-3 inline-flex text-sm font-medium text-emerald-800 hover:underline">Promote to a regression eval →</Link>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Why this is a pattern, not a one-off</p>
            <p className="mt-2 text-sm leading-6 text-zinc-800">{trendCopy(cluster.trend, cluster.finding_count)}</p>
            <p className="mt-3 text-sm leading-6 text-zinc-600">{meta.customerSignal}</p>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <p className="text-sm font-semibold text-zinc-900">Occurrences in this pattern ({members.length})</p>
              <Link href={gapsHref} className="text-sm text-zinc-600 hover:text-zinc-900">Open as gap list →</Link>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="border-y border-zinc-200 text-left text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="py-2 px-4">Severity</th>
                  <th className="py-2 px-4">Failure mode</th>
                  <th className="py-2 px-4">Evidence</th>
                  <th className="py-2 px-4">Trace</th>
                </tr>
              </thead>
              <tbody>
                {members.map((f) => (
                  <tr key={f.finding_id} className="border-b border-zinc-100 hover:bg-zinc-50 align-top">
                    <td className="py-3 px-4"><SeverityBadge severity={f.severity} /></td>
                    <td className="py-3 px-4 max-w-xs">
                      <Link href={"/findings/" + f.finding_id} className="font-medium text-zinc-950 hover:text-blue-700">{f.failure_mode}</Link>
                    </td>
                    <td className="py-3 px-4 text-zinc-600 max-w-sm leading-5">{firstEvidence(f)}</td>
                    <td className="py-3 px-4">
                      <Link href={"/traces/" + f.task_id} className="whitespace-nowrap text-sm font-medium text-blue-700 hover:text-blue-900">Read trace</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Time window</p>
            <p className="mt-1 text-sm text-zinc-800">{cluster.time_window}</p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Failure modes ({failureModes.length})</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {failureModes.map((fm) => (
                <span key={fm} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{fm}</span>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Shared evidence signals</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {topKeywords.map(([kw, n]) => (
                <span key={kw} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{kw}{n > 1 ? " ·" + n : ""}</span>
              ))}
              {topKeywords.length === 0 && <span className="text-xs text-zinc-400">No shared keywords.</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
