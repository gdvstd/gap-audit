import liveRawTracesJson from "@/fixtures/live-traces/raw-traces.json";
import generatedRawTracesJson from "@/fixtures/generated-traces/raw-traces.json";
import type { AuditArtifact } from "@/lib/contracts/audit-artifact";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import type { RawSpan, RawTraceArtifact } from "@/lib/normalizer/raw-trace";

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

export function Token({ value }: { value: string }) {
  return <span className={"inline-flex rounded border px-2 py-0.5 text-xs font-medium " + statusClass(value)}>{value}</span>;
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
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{payload.label}</div>
      <pre className={(language === "json" ? "font-mono" : "font-sans") + " max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-5 text-zinc-800"}>
        {payloadText(payload.value)}
      </pre>
    </div>
  );
}

function severityRank(severity: AuditFinding["severity"]): number {
  const rank: Record<AuditFinding["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return rank[severity];
}

export function primaryFinding(findings: AuditFinding[]): AuditFinding | undefined {
  return [...findings].sort((a, b) => {
    const d = severityRank(b.severity) - severityRank(a.severity);
    return d !== 0 ? d : b.confidence - a.confidence;
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

function findRawTrace(taskId: string): RawTraceArtifact | undefined {
  return rawTraces.find((trace) => trace.trace_id === taskId);
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
  const payloadLabel = tone === "action" ? "Action" : tone === "verification" ? "Verification" : tone === "memory" ? "Memory write" : tone === "guardrail" ? "Guardrail" : "Tool";
  const payloads: TracePayload[] = [
    { label: payloadLabel + " input", value: span.input ?? "Not captured in this trace." },
    { label: payloadLabel + " output", value: span.output ?? "No output captured." },
  ];
  if (span.attributes !== undefined) payloads.push({ label: "Span attributes", value: span.attributes });
  payloads.push({
    label: "Span timing",
    value: { span_id: span.span_id, parent_span_id: span.parent_span_id ?? null, start_time: span.start_time, end_time: span.end_time ?? null },
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

function buildTraceSteps(artifact: AuditArtifact): TraceStep[] {
  const companyTask = artifact.company_task ?? artifact.declared_goal;
  const finalResponse = artifact.final_response_summary ?? artifact.final_output_summary;
  const raw = findRawTrace(artifact.task_id);

  if (raw !== undefined) {
    const incoming = raw.user_input ?? raw.customer_input ?? artifact.user_input_summary;
    const steps: TraceStep[] = [
      {
        tone: "input",
        eyebrow: "incoming task",
        title: "Trace started from an incoming request",
        body: incoming,
        payloads: [
          { label: "Incoming task payload", value: incoming },
          { label: "Support context", value: raw.support_context ?? "No support context captured.", language: raw.support_context === undefined ? "text" : "json" },
        ],
      },
      {
        tone: "context",
        eyebrow: "assigned work",
        title: "Agent interpreted the company task",
        body: raw.company_task ?? raw.declared_goal ?? companyTask,
        payloads: [
          { label: "Company task", value: raw.company_task ?? companyTask },
          { label: "Declared goal", value: raw.declared_goal ?? artifact.declared_goal },
        ],
      },
    ];
    for (const span of raw.spans) steps.push(traceStepFromSpan(span));
    steps.push({
      tone: "output",
      eyebrow: "final response",
      title: "Agent completed the interaction",
      body: raw.final_response ?? raw.final_output ?? finalResponse,
      badge: raw.agent_status ?? artifact.agent_status,
      ...(raw.agent_confidence !== undefined ? { detail: "confidence " + (raw.agent_confidence * 100).toFixed(0) + "%" } : {}),
      payloads: [
        { label: "Agent response", value: raw.final_response ?? raw.final_output ?? finalResponse },
        { label: "Recorded decision payload", value: { task_id: artifact.task_id, declared_goal: raw.declared_goal ?? artifact.declared_goal, status: raw.agent_status ?? artifact.agent_status, confidence: raw.agent_confidence ?? artifact.agent_confidence ?? null } },
        { label: "Recorded reasoning", value: findRecordedReasoning(raw) ?? "Not captured in this trace. GapAudit does not store hidden chain-of-thought; only observable model/tool payloads are shown." },
      ],
    });
    return steps;
  }

  const steps: TraceStep[] = [
    { tone: "input", eyebrow: "incoming task", title: "Trace started from an incoming request", body: artifact.user_input_summary, payloads: [{ label: "Incoming task payload", value: artifact.user_input_summary }] },
    { tone: "context", eyebrow: "assigned work", title: "Agent interpreted the company task", body: companyTask, payloads: [{ label: "Company task", value: companyTask }, { label: "Declared goal", value: artifact.declared_goal }] },
  ];
  for (const fact of artifact.tool_facts) {
    steps.push({ tone: "tool", eyebrow: "tool result", title: fact.tool, badge: fact.status, body: fact.fact, payloads: [{ label: "Tool input", value: "Not captured in this trace." }, { label: "Tool output", value: fact.fact }] });
  }
  for (const event of artifact.guardrail_events) {
    const detail = [event.count !== undefined ? String(event.count) + " events" : undefined, event.time_window].filter((i): i is string => i !== undefined).join(" / ");
    steps.push({ tone: "guardrail", eyebrow: "guardrail", title: event.type, body: event.reason, ...(detail !== "" ? { detail } : {}), payloads: [{ label: "Guardrail payload", value: { ...event } }] });
  }
  for (const action of artifact.actions_taken) {
    steps.push({ tone: "action", eyebrow: "agent action", title: action.type, badge: action.visibility, body: action.target ?? "No target recorded.", detail: action.reversible ? "reversible" : "not reversible", payloads: [{ label: "Action payload", value: { ...action } }] });
  }
  for (const verification of artifact.verification_artifacts ?? []) {
    steps.push({ tone: "verification", eyebrow: "verification", title: verification.type, badge: verification.status, body: verification.summary, payloads: [{ label: "Verification payload", value: { ...verification } }] });
  }
  for (const write of artifact.memory_writes) {
    steps.push({ tone: "memory", eyebrow: "memory write", title: write.store, body: write.content_summary, ...(write.retention_risk !== undefined ? { badge: write.retention_risk } : {}), payloads: [{ label: "Memory write payload", value: { ...write } }] });
  }
  steps.push({
    tone: "output",
    eyebrow: "final response",
    title: "Agent completed the interaction",
    body: finalResponse,
    badge: artifact.agent_status,
    payloads: [
      { label: "Agent response", value: finalResponse },
      { label: "Recorded decision payload", value: { task_id: artifact.task_id, declared_goal: artifact.declared_goal, status: artifact.agent_status, confidence: artifact.agent_confidence ?? null } },
      { label: "Recorded reasoning", value: "Not captured in this trace. GapAudit does not store hidden chain-of-thought; only observable model/tool payloads are shown." },
    ],
  });
  return steps;
}

/** The verbatim input the user actually submitted (from the raw trace), if captured. */
export function getRawInput(artifact: AuditArtifact): string | undefined {
  const raw = findRawTrace(artifact.task_id);
  return raw?.user_input ?? raw?.customer_input;
}

/** Deep-link to this trace in Arize Phoenix (the source the auditor read from). */
export function getPhoenixTraceUrl(artifact: AuditArtifact): string | undefined {
  const base = (process.env["PHOENIX_COLLECTOR_ENDPOINT"] ?? "").replace(/\/v1\/traces\/?$/, "") || (process.env["PHOENIX_HOST"] ?? "");
  const projectId = process.env["PHOENIX_PROJECT_ID"] ?? "";
  if (artifact.phoenix_trace_id === undefined || base === "" || projectId === "") return undefined;
  return `${base}/projects/${projectId}/traces/${artifact.phoenix_trace_id}`;
}

/**
 * Two clearly separated groups:
 *  - OBSERVED in the trace (input · task · output) — the real record the agent left.
 *  - AUDIT AGENT JUDGMENT (expected output · problem) — what GapAudit derived; NOT trace data.
 */
export function IOProblemTriplet({ input, task, output, expected, problemLabel, problemText }: {
  input: string;
  task: string;
  output: string;
  expected: string;
  problemLabel: string;
  problemText: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Observed in trace</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Input</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{input}</p>
          </div>
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Task</p>
            <p className="mt-2 text-sm leading-6 text-zinc-800">{task}</p>
          </div>
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Output</p>
            <p className="mt-2 text-sm leading-6 text-zinc-800">{output}</p>
          </div>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Audit agent judgment</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Expected output</p>
            <p className="mt-2 text-sm leading-6 text-emerald-950">{expected}</p>
          </div>
          <div className="rounded border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs uppercase tracking-wide text-rose-600">Problem · {problemLabel}</p>
            <p className="mt-2 text-sm leading-6 text-rose-950">{problemText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The span-by-span trace replay. Flags steps used as evidence by `findings`. */
export function TraceReplay({ artifact, findings }: { artifact: AuditArtifact; findings: AuditFinding[] }) {
  const steps = buildTraceSteps(artifact);
  return (
    <div className="space-y-0">
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
                      {step.payloads.map((payload) => <PayloadBlock key={payload.label} payload={payload} />)}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
