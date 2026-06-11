import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { parseQuery, listFindingsRequest } from "@/app/api/findings/logic";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { StatusPill } from "@/app/_components/status-pill";
import { GAP_LENSES, agentLabel, firstEvidence, lensMeta } from "@/app/_components/gap-audit-copy";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function FindingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") urlParams.set(key, value);
  }

  const query = parseQuery(urlParams);
  const memory = await getMemory();
  const { findings } = await listFindingsRequest(memory, query);
  const [clusters, decisions, allFindings] = await Promise.all([
    memory.listClusters(),
    memory.listReviewDecisions(),
    memory.listFindings(),
  ]);

  const clusterById = new Map(clusters.map((cluster) => [cluster.cluster_id, cluster]));
  const decisionsByFinding = new Map<string, string>();
  for (const decision of decisions) {
    decisionsByFinding.set(decision.finding_id, decision.decision);
  }

  function getStatus(finding: { finding_id: string; converted_to_eval: boolean }) {
    if (finding.converted_to_eval) return "converted" as const;
    const decision = decisionsByFinding.get(finding.finding_id);
    if (decision === "confirmed") return "confirmed" as const;
    if (decision === "dismissed") return "dismissed" as const;
    return "pending" as const;
  }

  const severityOptions = ["", "low", "medium", "high", "critical"];
  const statusOptions = ["", "pending", "confirmed", "dismissed", "converted"];
  const agentOptions = Array.from(new Set(allFindings.map((finding) => finding.agent_id))).sort();
  const lensCounts = GAP_LENSES.map((lens) => ({ lens, count: allFindings.filter((finding) => finding.lens === lens.id).length }))
    .filter((item) => item.count > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Gaps</p>
          <h1 className="text-2xl font-semibold text-zinc-950 mt-1">What went wrong after &ldquo;done&rdquo;</h1>
          <p className="text-sm text-zinc-500 mt-1">Each finding ties a completed trace to the failure it hid.</p>
        </div>
        <div className="text-sm text-zinc-500">{findings.length} shown / {allFindings.length} total</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {lensCounts.map(({ lens, count }) => (
          <Link key={lens.id} href={"/findings?lens=" + encodeURIComponent(lens.id)} className={"border rounded-lg p-3 hover:border-zinc-400 " + lens.borderClass + " " + lens.bgClass}>
            <p className="text-sm font-medium text-zinc-900">{lens.shortLabel}</p>
            <p className="text-2xl font-semibold text-zinc-950 mt-1">{count}</p>
            <p className="text-xs text-zinc-600 mt-1 leading-4">{lens.customerSignal}</p>
          </Link>
        ))}
      </div>

      <form method="get" className="bg-white border border-zinc-200 rounded-lg p-3 flex flex-wrap gap-3 items-center">
        <select name="severity" defaultValue={query.severity ?? ""} className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white">
          {severityOptions.map((value) => (
            <option key={value} value={value}>{value === "" ? "All severity" : value}</option>
          ))}
        </select>
        <select name="lens" defaultValue={query.lens ?? ""} className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white">
          <option value="">All gap types</option>
          {GAP_LENSES.map((lens) => (
            <option key={lens.id} value={lens.id}>{lens.label}</option>
          ))}
        </select>
        <select name="agent_id" defaultValue={query.agent_id ?? ""} className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white">
          <option value="">All agents</option>
          {agentOptions.map((agentId) => (
            <option key={agentId} value={agentId}>{agentLabel(agentId)}</option>
          ))}
        </select>
        <select name="status" defaultValue={query.status ?? ""} className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white">
          {statusOptions.map((value) => (
            <option key={value} value={value}>{value === "" ? "All review status" : value}</option>
          ))}
        </select>
        <button type="submit" className="text-sm bg-zinc-900 text-white rounded px-3 py-1.5 hover:bg-zinc-700">
          Apply
        </button>
      </form>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase tracking-wide">
              <th className="py-3 px-3">Severity</th>
              <th className="py-3 px-3">Gap Type</th>
              <th className="py-3 px-3">Problem</th>
              <th className="py-3 px-3">Customer Evidence</th>
              <th className="py-3 px-3">Agent</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Pattern</th>
              <th className="py-3 px-3">Trace</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => {
              const status = getStatus(finding);
              const meta = lensMeta(finding.lens);
              const cluster = finding.cluster_id !== undefined ? clusterById.get(finding.cluster_id) : undefined;
              return (
                <tr key={finding.finding_id} className="border-b border-zinc-100 hover:bg-zinc-50 align-top">
                  <td className="py-3 px-3"><SeverityBadge severity={finding.severity} /></td>
                  <td className="py-3 px-3">
                    <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
                  </td>
                  <td className="py-3 px-3 max-w-xs">
                    <Link href={"/findings/" + finding.finding_id} className="text-zinc-950 font-medium hover:text-blue-700">
                      {finding.failure_mode}
                    </Link>
                    <p className="text-xs text-zinc-500 mt-1">{finding.recommended_action}</p>
                  </td>
                  <td className="py-3 px-3 text-zinc-600 max-w-sm leading-5">{firstEvidence(finding)}</td>
                  <td className="py-3 px-3 text-zinc-500 text-xs">
                    <div className="font-medium text-zinc-700">{agentLabel(finding.agent_id)}</div>
                    <div>{finding.task_id}</div>
                  </td>
                  <td className="py-3 px-3"><StatusPill status={status} /></td>
                  <td className="py-3 px-3 text-zinc-600">{cluster?.finding_count ?? 1}x</td>
                  <td className="py-3 px-3">
                    <Link href={"/traces/" + finding.task_id} className="whitespace-nowrap text-sm font-medium text-blue-700 hover:text-blue-900">
                      Read trace
                    </Link>
                  </td>
                </tr>
              );
            })}
            {findings.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-zinc-400 text-sm">
                  No service gaps match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
