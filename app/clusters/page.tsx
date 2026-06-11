import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { StatusPill } from "@/app/_components/status-pill";
import { agentLabel, humanizePatternName, lensMeta } from "@/app/_components/gap-audit-copy";
import type { Trend } from "@/lib/contracts/enums";

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

type TrendStatus = "confirmed" | "disabled" | "missing_config" | "dismissed" | "pending" | "converted";

function trendToStatus(trend: Trend): TrendStatus {
  if (trend === "new") return "confirmed";
  if (trend === "increasing") return "missing_config";
  return "disabled";
}

export default async function ClustersPage() {
  const memory = await getMemory();
  const clusters = await memory.listClusters();

  const sorted = [...clusters].sort((a, b) => {
    const severityDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (severityDiff !== 0) return severityDiff;
    return b.finding_count - a.finding_count;
  });
  const maxCount = Math.max(1, ...sorted.map((cluster) => cluster.finding_count));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Patterns</p>
        <h1 className="text-2xl font-semibold text-zinc-950 mt-1">One-off failures that became systemic</h1>
        <p className="text-sm text-zinc-500 mt-1">Findings grouped by agent, failure mode, and evidence — fix the workflow, not the ticket.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {sorted.map((cluster) => {
          const lens = cluster.dominant_lenses[0] ?? "unknown";
          const meta = lensMeta(lens);
          const width = Math.max(8, Math.round((cluster.finding_count / maxCount) * 100));
          const detailHref = "/clusters/" + cluster.cluster_id;
          return (
            <section key={cluster.cluster_id} className="bg-white border border-zinc-200 rounded-lg p-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
                    <SeverityBadge severity={cluster.severity} />
                    <StatusPill status={trendToStatus(cluster.trend)} label={cluster.trend} />
                  </div>
                  <Link href={detailHref} className="block mt-3 text-base font-semibold text-zinc-950 hover:text-blue-700">
                    {humanizePatternName(cluster.pattern_name)}
                  </Link>
                  <p className="text-sm text-zinc-600 mt-2 leading-5">{meta.problem}</p>
                  <p className="text-sm text-zinc-800 mt-3 leading-5">{cluster.recommended_action}</p>
                </div>
                <div className="border-l-0 lg:border-l border-zinc-100 lg:pl-4">
                  <p className="text-xs text-zinc-500">Affected agent</p>
                  <p className="text-sm font-medium text-zinc-900 mt-1">{agentLabel(cluster.agent_id)}</p>
                  <p className="text-xs text-zinc-500 mt-1">{cluster.finding_count} findings</p>
                  <div className="h-2 rounded bg-zinc-100 overflow-hidden mt-3">
                    <div className={"h-full rounded " + meta.barClass} style={{ width: width + "%" }} />
                  </div>
                  <p className="text-xs text-zinc-500 mt-3">{cluster.time_window}</p>
                </div>
              </div>
            </section>
          );
        })}
        {sorted.length === 0 && (
          <div className="bg-white border border-zinc-200 rounded-lg py-10 text-center text-zinc-400 text-sm">
            No service patterns found. Run an audit to generate clusters.
          </div>
        )}
      </div>
    </div>
  );
}
