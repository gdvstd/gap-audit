import { notFound } from "next/navigation";
import { getMemory } from "@/lib/runtime/container";
import { getFindingDetail } from "@/app/api/findings/[id]/logic";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { StatusPill } from "@/app/_components/status-pill";
import { agentLabel, humanizePatternName, lensMeta } from "@/app/_components/gap-audit-copy";
import { confirmAction, dismissAction } from "./actions";
import { ConvertToRegression } from "./convert-to-regression";
import { TraceReplay, IOProblemTriplet, getPhoenixTraceUrl, getRawInput } from "@/app/_components/trace-flow";

type PageParams = Promise<{ id: string }>;

export default async function FindingDetailPage({ params }: { params: PageParams }) {
  const { id } = await params;
  const memory = await getMemory();
  const result = await getFindingDetail(memory, id);
  if (!result.ok) notFound();

  const { finding, decisions, cluster, artifact } = result.value;
  const meta = lensMeta(finding.lens);

  const isConfirmed = decisions.some((d) => d.decision === "confirmed");
  const isDismissed = decisions.some((d) => d.decision === "dismissed");
  let statusValue: "confirmed" | "dismissed" | "converted" | "pending" = "pending";
  if (finding.converted_to_eval) statusValue = "converted";
  else if (isConfirmed) statusValue = "confirmed";
  else if (isDismissed) statusValue = "dismissed";

  const inputSummary = artifact?.user_input_summary ?? artifact?.customer_input_summary ?? artifact?.declared_goal ?? "Not captured in this trace.";
  const rawInput = artifact !== undefined ? getRawInput(artifact) : undefined;
  const task = artifact?.company_task ?? artifact?.declared_goal ?? "Not captured in this trace.";
  const expected = artifact?.customer_goal ?? artifact?.declared_goal ?? "Not captured in this trace.";
  const actual = artifact?.final_response_summary ?? artifact?.final_output_summary ?? "Not captured in this trace.";
  const phoenixUrl = artifact !== undefined ? getPhoenixTraceUrl(artifact) : undefined;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={"inline-flex px-2 py-1 rounded border text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
              <SeverityBadge severity={finding.severity} />
              <StatusPill status={statusValue} />
            </div>
            <h1 className="text-2xl font-semibold text-zinc-950 mt-3">{finding.failure_mode}</h1>
          </div>
          <div className="text-sm text-zinc-500 lg:text-right">
            <div>{agentLabel(finding.agent_id)}</div>
            <div className="font-mono text-xs mt-1">{finding.task_id}</div>
            <div className="mt-1">confidence {(finding.confidence * 100).toFixed(0)}%</div>
          </div>
        </div>
      </section>

      {/* Input → Expected output → Problem triplet */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <IOProblemTriplet inputSummary={inputSummary} rawInput={rawInput} task={task} expected={expected} actual={actual} problemLabel={meta.label} problemText={meta.problem} />
      </section>

      {/* Expandable trace replay + Phoenix link */}
      {artifact !== undefined && (
        <section className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Trace</p>
            {phoenixUrl !== undefined && (
              <a href={phoenixUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 self-start rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:border-violet-500">
                open original trace in Arize Phoenix ↗
              </a>
            )}
          </div>
          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm font-medium text-zinc-900 hover:text-blue-700">
              Trace replay — what happened step by step <span className="text-xs font-normal text-zinc-500">(flagged steps = this finding&apos;s evidence)</span>
            </summary>
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <TraceReplay artifact={artifact} findings={[finding]} />
            </div>
          </details>
        </section>
      )}

      {/* Why this is a service problem + recommended fix */}
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

      {/* Review actions */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Review action</p>
        <div className="flex flex-wrap gap-3">
          <form action={async () => { "use server"; await confirmAction(finding.finding_id); }}>
            <button type="submit" disabled={isConfirmed || finding.converted_to_eval}
              className="text-sm px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed">
              Confirm service gap
            </button>
          </form>
          <form action={async () => { "use server"; await dismissAction(finding.finding_id); }}>
            <button type="submit" disabled={isDismissed || finding.converted_to_eval}
              className="text-sm px-3 py-1.5 rounded bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed">
              Dismiss
            </button>
          </form>
          <ConvertToRegression findingId={finding.finding_id} confirmed={isConfirmed} converted={finding.converted_to_eval} failureMode={finding.failure_mode} />
        </div>
      </section>
    </div>
  );
}
