import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemory } from "@/lib/runtime/container";
import { SeverityBadge } from "@/app/_components/severity-badge";
import { agentLabel, lensMeta } from "@/app/_components/gap-audit-copy";
import liveRawTracesJson from "@/fixtures/live-traces/raw-traces.json";
import generatedRawTracesJson from "@/fixtures/generated-traces/raw-traces.json";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { RawSpan, RawTraceArtifact } from "@/lib/normalizer/raw-trace";

type PageParams = Promise<{ task_id: string }>;

type TraceStepTone = "input" | "context" | "tool" | "action" | "verification" | "memory" | "guardrail" | "output";

type TraceStep = {
  tone: TraceStepTone;
  title: string;
  eyebrow: string;
  body: string;
  badge?: string;
  detail?: string;
  payloads?: TracePayload[];
};

type TracePayload = {
  label: string;
  value: unknown;
  language?: "text" | "json";
};

const rawTraces = [
  ...(liveRawTracesJson as RawTraceArtifact[]),
  ...(generatedRawTracesJson as RawTraceArtifact[]),
];

function statusClass(value: string): string {
  if (["success", "passed", "resolved", "external"].includes(value)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["failed", "blocked", "critical", "private"].includes(value)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (["partial", "missing", "needs_review", "internal"].includes(value)) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function Token({ value }: { value: string }) {
  return <span className={"inline-flex rounded border px-2 py-0.5 text-xs font-medium " + statusClass(value)}>{value}</span>;
}

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
          {values.map((item) => (
            <span key={item} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{item}</span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No signal recorded.</p>
      )}
    </div>
  );
}

function findRawTrace(taskId: string): RawTraceArtifact | undefined {
  return rawTraces.find((trace) => trace.trace_id === taskId);
}

function payloadLanguage(value: unknown, preferred?: "text" | "json"): "text" | "json" {
  if (preferred !== undefined) return preferred;
  return typeof value === "string" ? "text" : "json";
}

function payloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Not captured in this trace.";
  return JSON.stringify(value, null, 2);
}

function PayloadBlock({ payload }: { payload: TracePayload }) {
  const language = payloadLanguage(payload.value, payload.language);
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50">
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {payload.label}
      </div>
      <pre className={(language === "json" ? "font-mono" : "font-sans") + " max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-5 text-zinc-800"}>
        {payloadText(payload.value)}
      </pre>
    </div>
  );
}

function severityRank(severity: AuditFinding["severity"]): number {
  const rank: Record<AuditFinding["severity"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return rank[severity];
}

function primaryFinding(findings: AuditFinding[]): AuditFinding | undefined {
  return [...findings].sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.confidence - a.confidence;
  })[0];
}

function evidenceForStep(step: TraceStep, findings: AuditFinding[]): string | undefined {
  const title = step.title.toLowerCase();
  const body = step.body.toLowerCase();
  for (const finding of findings) {
    for (const evidence of finding.evidence) {
      const normalized = evidence.toLowerCase();
      if (title.length > 2 && normalized.includes(title)) return evidence;
      const bodyNeedle = body.slice(0, 64);
      if (bodyNeedle.length > 24 && normalized.includes(bodyNeedle)) return evidence;
    }
  }
  return undefined;
}

function ProblemBrief({
  finding,
  relatedFindings,
  customerGoal,
  finalResponse,
}: {
  finding: AuditFinding | undefined;
  relatedFindings: AuditFinding[];
  customerGoal: string;
  finalResponse: string;
}) {
  if (finding === undefined) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Problem</p>
        <h2 className="mt-2 text-xl font-semibold text-zinc-950">No service gap is linked to this trace.</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">The trace artifact is available, but GapAudit has not attached a finding to it.</p>
      </section>
    );
  }

  const meta = lensMeta(finding.lens);
  const secondaryFindings = relatedFindings.filter((item) => item.finding_id !== finding.finding_id);
  return (
    <section className={"rounded-lg border bg-white p-5 " + meta.borderClass}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={"inline-flex rounded border px-2 py-1 text-xs font-medium " + meta.borderClass + " " + meta.bgClass + " " + meta.textClass}>{meta.label}</span>
            <SeverityBadge severity={finding.severity} />
            <span className="text-xs text-zinc-500">confidence {(finding.confidence * 100).toFixed(0)}%</span>
          </div>
          <p className="mt-4 text-xs uppercase tracking-wide text-zinc-500">Problem</p>
          <h2 className="mt-1 text-2xl font-semibold leading-8 text-zinc-950">{finding.failure_mode}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">{meta.problem}</p>
        </div>
        <Link href={"/findings/" + finding.finding_id} className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-500">
          Finding detail
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Expected outcome</p>
          <p className="mt-2 text-sm leading-6 text-zinc-800">{customerGoal}</p>
        </div>
        <div className="rounded border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs uppercase tracking-wide text-rose-600">Agent ended with</p>
          <p className="mt-2 text-sm leading-6 text-rose-950">{finalResponse}</p>
        </div>
      </div>

      <div className="mt-5 rounded border border-zinc-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Why this is a problem</p>
        <p className="mt-2 text-sm leading-6 text-zinc-800">{meta.customerSignal}</p>
        <ul className="mt-3 space-y-2">
          {finding.evidence.slice(0, 3).map((evidence, index) => (
            <li key={index} className="flex gap-2 text-sm leading-6 text-zinc-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
              <span>{evidence}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs uppercase tracking-wide text-emerald-700">Recommended fix</p>
        <p className="mt-2 text-sm leading-6 text-emerald-950">{finding.recommended_action || meta.defaultAction}</p>
      </div>

      {secondaryFindings.length > 0 && (
        <details className="mt-4 rounded border border-zinc-200 bg-zinc-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700">Other linked findings ({secondaryFindings.length})</summary>
          <div className="space-y-2 border-t border-zinc-200 bg-white p-3">
            {secondaryFindings.map((item) => (
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
  );
}

function stepDotClass(tone: TraceStepTone): string {
  const classes: Record<TraceStepTone, string> = {
    input: "bg-blue-600 ring-blue-100",
    context: "bg-zinc-700 ring-zinc-100",
    tool: "bg-violet-600 ring-violet-100",
    action: "bg-amber-600 ring-amber-100",
    verification: "bg-emerald-600 ring-emerald-100",
    memory: "bg-fuchsia-600 ring-fuchsia-100",
    guardrail: "bg-rose-600 ring-rose-100",
    output: "bg-zinc-950 ring-zinc-200",
  };
  return classes[tone];
}

function buildTraceSteps(input: {
  customerGoal: string;
  companyTask: string;
  finalResponse: string;
  taskId: string;
  agentStatus: string;
  agentConfidence?: number;
  declaredGoal: string;
  toolFacts: Array<{ tool: string; status: string; fact: string }>;
  actionsTaken: Array<{ type: string; target?: string; visibility: string; reversible: boolean }>;
  verificationArtifacts: Array<{ type: string; status: string; summary: string }>;
  memoryWrites: Array<{ store: string; content_summary: string; retention_risk?: string }>;
  guardrailEvents: Array<{ type: string; reason: string; count?: number; time_window?: string }>;
  rawTrace?: RawTraceArtifact;
}): TraceStep[] {
  if (input.rawTrace !== undefined) {
    const raw = input.rawTrace;
    const rawSteps: TraceStep[] = [
      {
        tone: "input",
        eyebrow: "incoming task",
        title: "Trace started from an incoming request",
        body: raw.customer_goal ?? raw.customer_input ?? raw.user_input ?? input.customerGoal,
        payloads: [
          { label: "Incoming task payload", value: raw.user_input ?? raw.customer_input ?? input.customerGoal },
          { label: "Expected outcome", value: raw.customer_goal ?? input.customerGoal },
          { label: "Support context", value: raw.support_context ?? "No support context captured.", language: raw.support_context === undefined ? "text" : "json" },
        ],
      },
      {
        tone: "context",
        eyebrow: "assigned work",
        title: "Agent interpreted the company task",
        body: raw.company_task ?? raw.declared_goal ?? input.companyTask,
        payloads: [
          { label: "Company task", value: raw.company_task ?? input.companyTask },
          { label: "Declared goal", value: raw.declared_goal ?? input.declaredGoal },
        ],
      },
    ];

    for (const span of raw.spans) {
      rawSteps.push(traceStepFromSpan(span));
    }

    rawSteps.push({
      tone: "output",
      eyebrow: "final response",
      title: "Agent completed the interaction",
      body: raw.final_response ?? raw.final_output ?? input.finalResponse,
      badge: raw.agent_status ?? input.agentStatus,
      ...(raw.agent_confidence !== undefined ? { detail: "confidence " + (raw.agent_confidence * 100).toFixed(0) + "%" } : {}),
      payloads: [
        { label: "Agent response", value: raw.final_response ?? raw.final_output ?? input.finalResponse },
        {
          label: "Recorded decision payload",
          value: {
            task_id: input.taskId,
            declared_goal: raw.declared_goal ?? input.declaredGoal,
            status: raw.agent_status ?? input.agentStatus,
            confidence: raw.agent_confidence ?? input.agentConfidence ?? null,
          },
        },
        {
          label: "Recorded reasoning",
          value: findRecordedReasoning(raw) ?? "Not captured in this trace. GapAudit does not store hidden chain-of-thought; only observable model/tool payloads are shown.",
        },
      ],
    });

    return rawSteps;
  }

  const steps: TraceStep[] = [
    {
      tone: "input",
      eyebrow: "incoming task",
      title: "Trace started from an incoming request",
      body: input.customerGoal,
      payloads: [{ label: "Incoming task payload", value: input.customerGoal }],
    },
    {
      tone: "context",
      eyebrow: "assigned work",
      title: "Agent interpreted the company task",
      body: input.companyTask,
      payloads: [
        { label: "Company task", value: input.companyTask },
        { label: "Declared goal", value: input.declaredGoal },
      ],
    },
  ];

  for (const fact of input.toolFacts) {
    steps.push({
      tone: "tool",
      eyebrow: "tool result",
      title: fact.tool,
      badge: fact.status,
      body: fact.fact,
      payloads: [
        { label: "Tool input", value: "Not captured in this trace." },
        { label: "Tool output", value: fact.fact },
      ],
    });
  }

  for (const event of input.guardrailEvents) {
    const detail = [event.count !== undefined ? String(event.count) + " events" : undefined, event.time_window]
      .filter((item): item is string => item !== undefined)
      .join(" / ");
    steps.push({
      tone: "guardrail",
      eyebrow: "guardrail",
      title: event.type,
      body: event.reason,
      ...(detail !== "" ? { detail } : {}),
      payloads: [{ label: "Guardrail payload", value: { ...event } }],
    });
  }

  for (const action of input.actionsTaken) {
    steps.push({
      tone: "action",
      eyebrow: "agent action",
      title: action.type,
      badge: action.visibility,
      body: action.target ?? "No target recorded.",
      detail: action.reversible ? "reversible" : "not reversible",
      payloads: [{ label: "Action payload", value: { ...action } }],
    });
  }

  for (const verification of input.verificationArtifacts) {
    steps.push({
      tone: "verification",
      eyebrow: "verification",
      title: verification.type,
      badge: verification.status,
      body: verification.summary,
      payloads: [{ label: "Verification payload", value: { ...verification } }],
    });
  }

  for (const write of input.memoryWrites) {
    steps.push({
      tone: "memory",
      eyebrow: "memory write",
      title: write.store,
      body: write.content_summary,
      ...(write.retention_risk !== undefined ? { badge: write.retention_risk } : {}),
      payloads: [{ label: "Memory write payload", value: { ...write } }],
    });
  }

  steps.push({
    tone: "output",
    eyebrow: "final response",
    title: "Agent completed the interaction",
    body: input.finalResponse,
    badge: input.agentStatus,
    payloads: [
      { label: "Agent response", value: input.finalResponse },
      {
        label: "Recorded decision payload",
        value: {
          task_id: input.taskId,
          declared_goal: input.declaredGoal,
          status: input.agentStatus,
          confidence: input.agentConfidence ?? null,
        },
      },
      { label: "Recorded reasoning", value: "Not captured in this trace. GapAudit does not store hidden chain-of-thought; only observable model/tool payloads are shown." },
    ],
  });

  return steps;
}

function traceStepFromSpan(span: RawSpan): TraceStep {
  const tone = span.kind === "memory"
    ? "memory"
    : span.kind === "guardrail"
    ? "guardrail"
    : span.attributes?.["verification_type"] !== undefined
    ? "verification"
    : span.attributes?.["action_type"] !== undefined
    ? "action"
    : "tool";
  const eyebrow = span.kind === "guardrail"
    ? "guardrail"
    : span.kind === "memory"
    ? "memory write"
    : span.attributes?.["action_type"] !== undefined
    ? "agent action"
    : span.attributes?.["verification_type"] !== undefined
    ? "verification"
    : "tool call";
  const body = span.output ?? span.input ?? "No output recorded.";
  const payloadLabel = tone === "action"
    ? "Action"
    : tone === "verification"
    ? "Verification"
    : tone === "memory"
    ? "Memory write"
    : tone === "guardrail"
    ? "Guardrail"
    : "Tool";
  const payloads: TracePayload[] = [
    { label: payloadLabel + " input", value: span.input ?? "Not captured in this trace." },
    { label: payloadLabel + " output", value: span.output ?? "No output captured." },
  ];
  if (span.attributes !== undefined) {
    payloads.push({ label: "Span attributes", value: span.attributes });
  }
  payloads.push({
    label: "Span timing",
    value: {
      span_id: span.span_id,
      parent_span_id: span.parent_span_id ?? null,
      start_time: span.start_time,
      end_time: span.end_time ?? null,
    },
  });

  return {
    tone,
    eyebrow,
    title: span.name,
    body,
    ...(span.status !== undefined ? { badge: span.status } : {}),
    payloads,
  };
}

function findRecordedReasoning(raw: RawTraceArtifact): string | undefined {
  const reasoningSpan = raw.spans.find((span) => {
    const reason = span.attributes?.["reasoning"] ?? span.attributes?.["rationale"];
    return typeof reason === "string" || (span.kind === "llm" && typeof span.output === "string");
  });
  const attrReason = reasoningSpan?.attributes?.["reasoning"] ?? reasoningSpan?.attributes?.["rationale"];
  if (typeof attrReason === "string") return attrReason;
  if (reasoningSpan?.kind === "llm" && typeof reasoningSpan.output === "string") return reasoningSpan.output;
  return undefined;
}

function TraceRunPanel({ steps, findings, toolCount, actionCount, verificationCount }: { steps: TraceStep[]; findings: AuditFinding[]; toolCount: number; actionCount: number; verificationCount: number }) {
  return (
    <aside className="rounded-lg border border-zinc-200 bg-white p-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col 2xl:flex-row">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Trace replay</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">What happened</h2>
          <p className="mt-1 text-sm leading-5 text-zinc-500">Flagged steps are the parts GapAudit used as evidence.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5">
            <div className="font-semibold text-zinc-950">{toolCount}</div>
            <div className="text-zinc-500">tools</div>
          </div>
          <div className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5">
            <div className="font-semibold text-zinc-950">{actionCount}</div>
            <div className="text-zinc-500">actions</div>
          </div>
          <div className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5">
            <div className="font-semibold text-zinc-950">{verificationCount}</div>
            <div className="text-zinc-500">checks</div>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const matchedEvidence = evidenceForStep(step, findings);
          const flagged = matchedEvidence !== undefined;
          return (
            <div key={step.eyebrow + step.title + index} className="grid grid-cols-[2.25rem_1fr] gap-3">
              <div className="relative flex justify-center">
                <span className={"mt-1 h-3 w-3 rounded-full ring-4 " + stepDotClass(step.tone)} />
                {!isLast && <span className="absolute top-5 bottom-0 w-px bg-zinc-200" />}
              </div>
              <div className={isLast ? "pb-0" : "pb-5"}>
                <div className={(flagged ? "border-rose-300 bg-rose-50 shadow-rose-100" : "border-zinc-200 bg-white shadow-zinc-100") + " rounded border p-3 shadow-sm"}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">{step.eyebrow}</span>
                    {step.badge !== undefined && <Token value={step.badge} />}
                    {flagged && <span className="rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700">evidence</span>}
                  </div>
                  <p className="mt-2 text-sm font-medium text-zinc-950">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700">{step.body}</p>
                  {step.detail !== undefined && <p className="mt-2 text-xs text-zinc-500">{step.detail}</p>}
                  {matchedEvidence !== undefined && <p className="mt-2 rounded border border-rose-200 bg-white px-3 py-2 text-xs leading-5 text-rose-900">{matchedEvidence}</p>}
                  {step.payloads !== undefined && step.payloads.length > 0 && (
                    <details className="mt-3 rounded border border-zinc-200 bg-white/70">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700">Inspect payload</summary>
                      <div className="space-y-3 border-t border-zinc-200 bg-white p-3">
                        {step.payloads.map((payload) => (
                          <PayloadBlock key={payload.label} payload={payload} />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default async function TraceArtifactPage({ params }: { params: PageParams }) {
  const { task_id } = await params;
  const memory = await getMemory();
  const artifact = await memory.getArtifact(task_id);

  if (artifact === null) {
    notFound();
  }

  const allFindings = await memory.listFindings();
  const relatedFindings = allFindings.filter((finding) => finding.task_id === artifact.task_id);

  const customerGoal = artifact.customer_goal ?? artifact.declared_goal ?? artifact.user_input_summary;
  const companyTask = artifact.company_task ?? artifact.declared_goal;
  const finalResponse = artifact.final_response_summary ?? artifact.final_output_summary;
  const support = artifact.support_context;
  const verificationArtifacts = artifact.verification_artifacts ?? [];
  const sourceRefs = artifact.source_refs ?? [];
  const rawTrace = findRawTrace(artifact.task_id);

  // Deep-link to this trace in Arize Phoenix (the source the auditor read from).
  const phoenixBase =
    (process.env.PHOENIX_COLLECTOR_ENDPOINT ?? "").replace(/\/v1\/traces\/?$/, "") ||
    (process.env.PHOENIX_HOST ?? "");
  const phoenixProjectId = process.env.PHOENIX_PROJECT_ID ?? "";
  const phoenixTraceUrl =
    artifact.phoenix_trace_id !== undefined && phoenixBase !== "" && phoenixProjectId !== ""
      ? `${phoenixBase}/projects/${phoenixProjectId}/traces/${artifact.phoenix_trace_id}`
      : undefined;
  const mainFinding = primaryFinding(relatedFindings);
  const traceSteps = buildTraceSteps({
    customerGoal,
    companyTask,
    finalResponse,
    taskId: artifact.task_id,
    agentStatus: artifact.agent_status,
    ...(artifact.agent_confidence !== undefined ? { agentConfidence: artifact.agent_confidence } : {}),
    declaredGoal: artifact.declared_goal,
    toolFacts: artifact.tool_facts,
    actionsTaken: artifact.actions_taken,
    verificationArtifacts,
    memoryWrites: artifact.memory_writes,
    guardrailEvents: artifact.guardrail_events,
    ...(rawTrace !== undefined ? { rawTrace } : {}),
  });

  return (
    <div className="max-w-7xl space-y-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Trace Artifact</p>
            {phoenixTraceUrl !== undefined ? (
              <a
                href={phoenixTraceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={"Open original trace in Arize Phoenix (" + artifact.phoenix_trace_id + ")"}
                className="group mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <h1 className="break-words font-mono text-xl font-semibold text-zinc-950 group-hover:text-violet-700 group-hover:underline">{artifact.task_id}</h1>
                <span className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 group-hover:border-violet-500">
                  open in Arize Phoenix <span aria-hidden>↗</span>
                </span>
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
          <ProblemBrief finding={mainFinding} relatedFindings={relatedFindings} customerGoal={customerGoal} finalResponse={finalResponse} />

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
                <pre className="max-h-[520px] overflow-auto rounded border border-zinc-200 bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
                  {JSON.stringify(artifact, null, 2)}
                </pre>
              </div>
            </details>
          </section>
        </div>

        <TraceRunPanel
          steps={traceSteps}
          findings={relatedFindings}
          toolCount={artifact.tool_facts.length}
          actionCount={artifact.actions_taken.length}
          verificationCount={verificationArtifacts.length}
        />
      </div>
    </div>
  );
}
