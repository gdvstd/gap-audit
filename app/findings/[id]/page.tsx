import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemory } from "@/lib/runtime/container";
import { getFindingDetail } from "@/app/api/findings/[id]/logic";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { StatusPill } from "@/app/_components/status-pill";
import { agentLabel, compactEvidence, humanizePatternName, lensMeta } from "@/app/_components/gap-audit-copy";
import { confirmAction, dismissAction, convertToEvalAction } from "./actions";

type PageParams = Promise<{ id: string }>;

export default async function FindingDetailPage({ params }: { params: PageParams }) {
  const { id } = await params;
  const memory = await getMemory();
  const result = await getFindingDetail(memory, id);

  if (!result.ok) {
    notFound();
  }

  const { finding, decisions, cluster, artifact, evalCase } = result.value;
  const meta = lensMeta(finding.lens);

  const isConfirmed = decisions.some((decision) => decision.decision === "confirmed");
  const isDismissed = decisions.some((decision) => decision.decision === "dismissed");

  let statusValue: "confirmed" | "dismissed" | "converted" | "pending" = "pending";
  if (finding.converted_to_eval) statusValue = "converted";
  else if (isConfirmed) statusValue = "confirmed";
  else if (isDismissed) statusValue = "dismissed";

  const customerGoal = artifact?.customer_goal ?? artifact?.declared_goal ?? artifact?.user_input_summary;
  const companyTask = artifact?.company_task ?? artifact?.declared_goal;
  const finalResponse = artifact?.final_output_summary;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
              <SeverityBadge severity={finding.severity} />
              <StatusPill status={statusValue} />
            </div>
            <h1 className="text-2xl font-semibold text-zinc-950 mt-3">{finding.failure_mode}</h1>
            <p className="text-sm text-zinc-600 mt-2 max-w-3xl leading-6">{meta.problem}</p>
          </div>
          <div className="text-sm text-zinc-500 lg:text-right">
            <div>{agentLabel(finding.agent_id)}</div>
            <div className="font-mono text-xs mt-1">{finding.task_id}</div>
            <div className="mt-1">confidence {(finding.confidence * 100).toFixed(0)}%</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Why this is a service problem</p>
          <p className="text-base text-zinc-900 mt-3 leading-7">{meta.customerSignal}</p>
          <div className="mt-5">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Evidence trail</p>
            <ul className="space-y-2">
              {finding.evidence.map((evidence, index) => (
                <li key={index} className="text-sm text-zinc-700 flex gap-2 leading-6">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                  <span>{evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Recommended fix</p>
          <p className="text-sm text-zinc-800 mt-3 leading-6">{finding.recommended_action || meta.defaultAction}</p>
          {cluster !== undefined && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">Pattern</p>
              <p className="text-sm font-medium text-zinc-900 mt-2">{humanizePatternName(cluster.pattern_name)}</p>
              <p className="text-xs text-zinc-500 mt-1">{cluster.finding_count} related findings</p>
            </div>
          )}
        </div>
      </section>

      {artifact !== undefined && (
        <section className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Trace outcome context</p>
            <Link href={"/traces/" + finding.task_id} className="text-sm font-medium text-blue-700 hover:text-blue-900">
              Read full trace artifact
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <p className="text-xs text-zinc-500">Customer wanted</p>
              <p className="text-sm text-zinc-800 mt-1 leading-6">{customerGoal}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Company task</p>
              <p className="text-sm text-zinc-800 mt-1 leading-6">{companyTask}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Agent final response</p>
              <p className="text-sm text-zinc-800 mt-1 leading-6">{finalResponse}</p>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-4">Audit summary: {compactEvidence(finding, 2)}</p>
        </section>
      )}

      {evalCase !== undefined && (
        <section className="bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Generated regression candidate</p>
          <p className="text-xs text-zinc-600 font-mono mt-2">{evalCase.eval_id}</p>
          <p className="text-sm text-zinc-700 mt-1">{evalCase.failure_mode_guarded}</p>
        </section>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Review action</p>
        <div className="flex flex-wrap gap-3">
          <form action={async () => { "use server"; await confirmAction(finding.finding_id); }}>
            <button
              type="submit"
              disabled={isConfirmed || finding.converted_to_eval}
              className="text-sm px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm service gap
            </button>
          </form>
          <form action={async () => { "use server"; await dismissAction(finding.finding_id); }}>
            <button
              type="submit"
              disabled={isDismissed || finding.converted_to_eval}
              className="text-sm px-3 py-1.5 rounded bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Dismiss
            </button>
          </form>
          <form action={async () => { "use server"; await convertToEvalAction(finding.finding_id); }}>
            <button
              type="submit"
              disabled={!isConfirmed || finding.converted_to_eval}
              className="text-sm px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Convert to regression
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
