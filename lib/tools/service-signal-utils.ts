import type { AuditArtifact } from "../contracts/audit-artifact.js";

export type ServiceSignalKind =
  | "human_request"
  | "frustration"
  | "already_tried"
  | "repeat_information"
  | "self_service_loop"
  | "churn_or_cancellation_intent"
  | "negative_feedback"
  | "apology_without_action";

export type ServiceConversationSignal = {
  kind: ServiceSignalKind;
  source: string;
  evidence: string;
};

type TextSource = {
  source: string;
  text: string;
};

const MAX_EVIDENCE_LENGTH = 180;

const ACTION_WORD_RE = /\b(escalat(?:e|ed|ing|ion)|handoff|refund(?:ed|ing)?|processed|approved|opened|created|routed|sent|scheduled|confirmed|resolved|paged|assigned)\b/i;

const SIGNAL_PATTERNS: Array<{
  kind: Exclude<ServiceSignalKind, "apology_without_action">;
  patterns: RegExp[];
}> = [
  {
    kind: "human_request",
    patterns: [
      /\b(human|person|representative|manager|live agent|support agent)\b/i,
      /\b(speak|talk|connect|transfer|escalate)\b.{0,40}\b(human|person|representative|manager|agent)\b/i,
    ],
  },
  {
    kind: "frustration",
    patterns: [
      /\b(frustrat(?:ed|ing)|angry|upset|annoyed|ridiculous|unacceptable|not listening|this is not working)\b/i,
    ],
  },
  {
    kind: "already_tried",
    patterns: [
      /\b(already tried|tried (?:this|that|it)|tried twice|contacted support|reached out|same issue|again)\b/i,
      /\b(prior contact|previous contact|came back|follow(?:ed)? up)\b/i,
    ],
  },
  {
    kind: "repeat_information",
    patterns: [
      /\b(already told|already provided|repeat myself|repeating myself|same question|provided this)\b/i,
    ],
  },
  {
    kind: "self_service_loop",
    patterns: [
      /\b(self[- ]service|help center|faq|article|settings\s*>|settings >|portal|use the link|click the link)\b/i,
      /\b(you can|please)\b.{0,60}\b(cancel|update|change|submit|retry)\b.{0,30}\b(settings|portal|account|billing|link)\b/i,
    ],
  },
  {
    kind: "churn_or_cancellation_intent",
    patterns: [
      /\b(cancel|cancellation|churn|leave|switch providers|close my account|refund)\b/i,
    ],
  },
  {
    kind: "negative_feedback",
    patterns: [
      /\b(thumbs[- ]down|low csat|csat[:= ]+[12]|one star|1-star|bad rating|negative feedback)\b/i,
    ],
  },
];

function truncate(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_EVIDENCE_LENGTH) return compact;
  return compact.slice(0, MAX_EVIDENCE_LENGTH);
}

function evidence(text: string): string {
  return truncate(text);
}

function addText(out: TextSource[], source: string, text: string | undefined): void {
  if (text !== undefined && text.trim().length > 0) {
    out.push({ source, text });
  }
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function collectArtifactTextSources(artifact: AuditArtifact): TextSource[] {
  const sources: TextSource[] = [];

  addText(sources, "customer_input_summary", artifact.customer_input_summary ?? artifact.user_input_summary);
  addText(sources, "customer_goal", artifact.customer_goal);
  addText(sources, "company_task", artifact.company_task ?? artifact.declared_goal);
  addText(sources, "final_response_summary", artifact.final_response_summary ?? artifact.final_output_summary);

  for (const fact of artifact.tool_facts) {
    addText(sources, `tool_facts.${fact.tool}`, fact.fact);
  }

  for (const write of artifact.memory_writes) {
    addText(sources, `memory_writes.${write.store}`, write.content_summary);
  }

  for (const event of artifact.guardrail_events) {
    addText(sources, `guardrail_events.${event.type}`, event.reason);
  }

  for (const verification of artifact.verification_artifacts ?? []) {
    addText(sources, `verification_artifacts.${verification.type}`, verification.summary);
  }

  for (const field of ["conversation_signals", "operational_signals", "business_signals"] as const) {
    for (const item of stringArrayFromUnknown(artifact[field])) {
      addText(sources, field, item);
    }
  }

  return sources;
}

export function extractServiceConversationSignals(artifact: AuditArtifact): ServiceConversationSignal[] {
  const signals: ServiceConversationSignal[] = [];
  const seen = new Set<string>();

  for (const source of collectArtifactTextSources(artifact)) {
    for (const def of SIGNAL_PATTERNS) {
      if (def.patterns.some((pattern) => pattern.test(source.text))) {
        const key = `${def.kind}\0${source.source}\0${source.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          signals.push({
            kind: def.kind,
            source: source.source,
            evidence: evidence(source.text),
          });
        }
      }
    }
  }

  const finalOutput = artifact.final_response_summary ?? artifact.final_output_summary;
  if (
    /\b(sorry|apolog(?:y|ize|ise|ized|ised|izing|ising))\b/i.test(finalOutput) &&
    !ACTION_WORD_RE.test(finalOutput)
  ) {
    signals.push({
      kind: "apology_without_action",
      source: "final_output_summary",
      evidence: evidence(finalOutput),
    });
  }

  signals.sort((a, b) => {
    const kindCompare = a.kind.localeCompare(b.kind);
    if (kindCompare !== 0) return kindCompare;
    const sourceCompare = a.source.localeCompare(b.source);
    if (sourceCompare !== 0) return sourceCompare;
    return a.evidence.localeCompare(b.evidence);
  });

  return signals;
}

export function countSignalsByKind(
  signals: ServiceConversationSignal[]
): Record<ServiceSignalKind, number> {
  const counts: Record<ServiceSignalKind, number> = {
    human_request: 0,
    frustration: 0,
    already_tried: 0,
    repeat_information: 0,
    self_service_loop: 0,
    churn_or_cancellation_intent: 0,
    negative_feedback: 0,
    apology_without_action: 0,
  };

  for (const signal of signals) {
    counts[signal.kind] += 1;
  }

  return counts;
}
