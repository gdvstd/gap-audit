import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { agentLabel, firstEvidence, lensMeta } from "@/app/_components/gap-audit-copy";

// Chronological feed of findings, newest first — so a fresh audit round's findings
// surface at the top with their detection time. Complements Gaps (by lens), Patterns
// (clusters), and Regression (evals) with a "what was just detected" timeline view.
function fmtTime(iso?: string): string {
  if (!iso) return "—";
  // "2026-06-11T06:37:15.711703+00:00" -> "2026-06-11 06:37:15 UTC"
  const m = iso.replace("T", " ").slice(0, 19);
  return m + " UTC";
}

export default async function ActivityPage() {
  const memory = await getMemory();
  const all = await memory.listFindings();

  const findings = [...all].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Audit activity</p>
          <h1 className="text-2xl font-semibold text-zinc-950 mt-1">Findings as they were detected</h1>
          <p className="text-sm text-zinc-600 mt-2 max-w-3xl">
            Every finding in detection order, newest first. A fresh audit round shows up at the top —
            this is the live record of what the GapAudit agent surfaced and when.
          </p>
        </div>
        <div className="text-sm text-zinc-500 text-right">
          <div>{findings.length} findings</div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase tracking-wide">
              <th className="py-3 px-3">Detected at</th>
              <th className="py-3 px-3">Severity</th>
              <th className="py-3 px-3">Gap Type</th>
              <th className="py-3 px-3">Problem</th>
              <th className="py-3 px-3">Evidence</th>
              <th className="py-3 px-3">Agent</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding, i) => {
              const meta = lensMeta(finding.lens);
              return (
                <tr
                  key={finding.finding_id}
                  className={"border-b border-zinc-100 hover:bg-zinc-50 align-top " + (i === 0 ? "bg-emerald-50/60" : "")}
                >
                  <td className="py-3 px-3 whitespace-nowrap text-xs text-zinc-600 font-mono">
                    {fmtTime(finding.created_at)}
                    {i === 0 && <span className="ml-2 inline-flex px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold">latest</span>}
                  </td>
                  <td className="py-3 px-3"><SeverityBadge severity={finding.severity} /></td>
                  <td className="py-3 px-3">
                    <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
                  </td>
                  <td className="py-3 px-3 max-w-xs">
                    <Link href={"/findings/" + finding.finding_id} className="text-zinc-950 font-medium hover:text-blue-700">
                      {finding.failure_mode}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-zinc-600 max-w-sm leading-5">{firstEvidence(finding)}</td>
                  <td className="py-3 px-3 text-zinc-500 text-xs">
                    <div className="font-medium text-zinc-700">{agentLabel(finding.agent_id)}</div>
                    <Link href={"/traces/" + finding.task_id} className="text-blue-700 hover:text-blue-900">{finding.task_id}</Link>
                  </td>
                </tr>
              );
            })}
            {findings.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-zinc-400 text-sm">
                  No findings yet. Run an audit round to populate the feed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
