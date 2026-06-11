import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemory } from "@/lib/runtime/container";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { agentLabel, lensMeta } from "@/app/_components/gap-audit-copy";
import { TraceReplay, IOProblemTriplet, getPhoenixTraceUrl, getRawInput, Token, primaryFinding } from "@/app/_components/trace-flow";

type PageParams = Promise<{ task_id: string }>;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function SignalList({ title, items }: { title: string; items: string[] | undefined }) {
  const values = items ?? [];
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{title}</p>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((item) => <span key={item} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{item}</span>)}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No signal recorded.</p>
      )}
    </div>
  );
}

export default async function TraceArtifactPage({ params }: { params: PageParams }) {
  const { task_id } = await params;
  const memory = await getMemory();
  const artifact = await memory.getArtifact(task_id);
  if (artifact === null) notFound();

  const allFindings = await memory.listFindings();
  const relatedFindings = allFindings.filter((f) => f.task_id === artifact.task_id);
  const mainFinding = primaryFinding(relatedFindings);
  const meta = mainFinding !== undefined ? lensMeta(mainFinding.lens) : undefined;
  const secondary = relatedFindings.filter((f) => mainFinding === undefined || f.finding_id !== mainFinding.finding_id);

  const inputSummary = artifact.user_input_summary ?? artifact.customer_input_summary ?? artifact.declared_goal;
  const rawInput = getRawInput(artifact);
  const task = artifact.company_task ?? artifact.declared_goal;
  const expected = artifact.customer_goal ?? artifact.declared_goal ?? artifact.user_input_summary;
  const actual = artifact.final_response_summary ?? artifact.final_output_summary;
  const phoenixUrl = getPhoenixTraceUrl(artifact);
  const support = artifact.support_context;
  const sourceRefs = artifact.source_refs ?? [];

  return (
    <div className="max-w-7xl space-y-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Trace Artifact</p>
            {phoenixUrl !== undefined ? (
              <a href={phoenixUrl} target="_blank" rel="noopener noreferrer" title={"Open original trace in Arize Phoenix (" + artifact.phoenix_trace_id + ")"} className="group mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="break-words font-mono text-xl font-semibold text-zinc-950 group-hover:text-violet-700 group-hover:underline">{artifact.task_id}</h1>
                <span className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 group-hover:border-violet-500">open in Arize Phoenix <span aria-hidden>↗</span></span>
              </a>
            ) : (
              <h1 className="mt-1 break-words font-mono text-xl font-semibold text-zinc-950">{artifact.task_id}</h1>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
            <Token value={artifact.agent_status} />
            {artifact.task_type !== undefined && <Token value={artifact.task_type} />}
            <Token value={agentLabel(artifact.agent_id)} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-100 pt-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Agent</p>
            <p className="mt-1 font-medium text-zinc-900">{agentLabel(artifact.agent_id)}</p>
            <p className="font-mono text-xs text-zinc-500">{artifact.agent_id}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Timestamp</p>
            <p className="mt-1 text-zinc-800">{formatDate(artifact.timestamp)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Agent Confidence</p>
            <p className="mt-1 text-zinc-800">{artifact.agent_confidence !== undefined ? (artifact.agent_confidence * 100).toFixed(0) + "%" : "Not recorded"}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        <div className="space-y-5">
          {/* Input → Expected output → Problem triplet */}
          <section className={"rounded-lg border bg-white p-5 " + (meta?.borderClass ?? "border-zinc-200")}>
            {mainFinding !== undefined && meta !== undefined ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={"inline-flex rounded border px-2 py-1 text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
                <SeverityBadge severity={mainFinding.severity} />
                <span className="text-xs text-zinc-500">confidence {(mainFinding.confidence * 100).toFixed(0)}%</span>
                <Link href={"/findings/" + mainFinding.finding_id} className="ml-auto shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-500">Finding detail →</Link>
              </div>
            ) : (
              <p className="mb-4 text-sm text-zinc-500">No service gap is linked to this trace.</p>
            )}

            <IOProblemTriplet
              inputSummary={inputSummary}
              rawInput={rawInput}
              task={task}
              expected={expected}
              actual={actual}
              problemLabel={meta?.label ?? "—"}
              problemText={mainFinding !== undefined && meta !== undefined ? mainFinding.failure_mode + " — " + meta.problem : "No finding attached to this trace."}
            />

            {mainFinding !== undefined && meta !== undefined && (
              <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-700">Recommended fix</p>
                <p className="mt-2 text-sm leading-6 text-emerald-950">{mainFinding.recommended_action || meta.defaultAction}</p>
              </div>
            )}

            {secondary.length > 0 && (
              <details className="mt-4 rounded border border-zinc-200 bg-zinc-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700">Other findings on this trace ({secondary.length})</summary>
                <div className="space-y-2 border-t border-zinc-200 bg-white p-3">
                  {secondary.map((item) => (
                    <Link key={item.finding_id} href={"/findings/" + item.finding_id} className="block rounded border border-zinc-200 p-3 hover:border-zinc-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={item.severity} />
                        <span className="text-xs text-zinc-500">{lensMeta(item.lens).label}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-zinc-900">{item.failure_mode}</p>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </section>

          {/* Raw artifact + signals */}
          <section className="rounded-lg border border-zinc-200 bg-white p-5">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-zinc-900">Trace metadata and raw artifact</summary>
              <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Service signals</p>
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                    <SignalList title="Conversation" items={artifact.conversation_signals} />
                    <SignalList title="Operational" items={artifact.operational_signals} />
                    <SignalList title="Business" items={artifact.business_signals} />
                  </div>
                </div>
                {support !== undefined && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Support context</p>
                    <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      {Object.entries(support).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-4 rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
                          <dt className="text-zinc-500">{key}</dt>
                          <dd className="text-right text-zinc-800">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {sourceRefs.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Source refs</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sourceRefs.map((source, index) => (
                        <span key={(source.external_id ?? source.label ?? source.source) + index} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
                          {source.source}{source.label !== undefined ? " / " + source.label : ""}{source.external_id !== undefined ? " / " + source.external_id : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <pre className="max-h-[520px] overflow-auto rounded border border-zinc-200 bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">{JSON.stringify(artifact, null, 2)}</pre>
              </div>
            </details>
          </section>
        </div>

        {/* Trace replay */}
        <aside className="rounded-lg border border-zinc-200 bg-white p-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-auto">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Trace replay</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">What happened</h2>
            <p className="mt-1 text-sm leading-5 text-zinc-500">Flagged steps are the parts GapAudit used as evidence.</p>
          </div>
          <div className="mt-5">
            <TraceReplay artifact={artifact} findings={relatedFindings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
