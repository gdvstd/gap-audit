/**
 * Arize trace-source adapter.
 *
 * Uses the Arize HTTP API (via global fetch or injected httpGet).
 * Never passes hidden actor context (system prompts, chain-of-thought) into
 * the mapping — only observable spans/inputs/outputs/tool calls/status.
 * Stores source references, not full raw payloads.
 */
import type { RawTraceArtifact, RawSpan, RawSpanKind } from "../normalizer/raw-trace.js";

// ── Adapter interface ─────────────────────────────────────────────────────

export type TraceSourceAdapter = {
  name: string;
  enabled(): boolean;
  listTraceArtifacts(input: {
    agent_id?: string;
    since?: string;
    limit?: number;
  }): Promise<RawTraceArtifact[]>;
};

// ── enabled() helper ──────────────────────────────────────────────────────

function isArizeEnabled(): boolean {
  return (
    process.env["ARIZE_ENABLED"] === "true" &&
    typeof process.env["ARIZE_PROJECT_ID"] === "string" &&
    process.env["ARIZE_PROJECT_ID"] !== "" &&
    typeof process.env["ARIZE_API_KEY"] === "string" &&
    process.env["ARIZE_API_KEY"] !== ""
  );
}

// ── Arize record shape (raw API response per trace) ───────────────────────

type ArizeSpanRecord = {
  span_id?: string;
  parent_span_id?: string;
  kind?: string;
  name?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  input?: string;
  output?: string;
};

type ArizeTraceRecord = {
  trace_id?: string;
  agent_id?: string;
  task_type?: string;
  started_at?: string;
  ended_at?: string;
  user_input?: string;
  final_output?: string;
  declared_goal?: string;
  agent_status?: string;
  agent_confidence?: number;
  status?: string;
  spans?: ArizeSpanRecord[];
};

type ArizeApiResponse = {
  data?: ArizeTraceRecord[];
};

// ── Pure mapping functions ────────────────────────────────────────────────
// Exported for unit testing.

function mapSpanKind(raw: string | undefined): RawSpanKind {
  const valid: RawSpanKind[] = ["agent", "llm", "tool", "retrieval", "guardrail", "memory", "unknown"];
  if (raw !== undefined && (valid as string[]).includes(raw)) {
    return raw as RawSpanKind;
  }
  return "unknown";
}

type SpanStatus = "ok" | "error" | "blocked" | "partial" | "unknown";

function mapSpanStatus(raw: string | undefined): SpanStatus {
  if (raw === "ok") return "ok";
  if (raw === "error") return "error";
  if (raw === "blocked") return "blocked";
  if (raw === "partial") return "partial";
  return "unknown";
}

function mapArizeSpan(raw: ArizeSpanRecord): RawSpan {
  const span: RawSpan = {
    span_id: raw.span_id ?? "unknown",
    kind: mapSpanKind(raw.kind),
    name: raw.name ?? "unknown",
    start_time: raw.start_time ?? new Date().toISOString(),
  };

  if (raw.parent_span_id !== undefined) span.parent_span_id = raw.parent_span_id;
  if (raw.end_time !== undefined) span.end_time = raw.end_time;
  if (raw.status !== undefined) span.status = mapSpanStatus(raw.status);
  if (raw.attributes !== undefined) span.attributes = { ...raw.attributes };
  if (raw.input !== undefined) span.input = raw.input;
  if (raw.output !== undefined) span.output = raw.output;

  return span;
}

/**
 * Maps a single Arize trace record to a RawTraceArtifact.
 *
 * Only observable artifacts are mapped. Hidden context fields
 * (system_prompt, chain_of_thought, internal_state, etc.) are
 * deliberately excluded — this boundary is what keeps SilentOps
 * artifact-level only.
 */
export function mapArizeRecord(raw: ArizeTraceRecord): RawTraceArtifact {
  const traceId = raw.trace_id ?? "unknown";
  const agentId = raw.agent_id ?? "unknown";
  const startedAt = raw.started_at ?? new Date().toISOString();

  const spans: RawSpan[] = (raw.spans ?? []).map(mapArizeSpan);

  const artifact: RawTraceArtifact = {
    trace_id: traceId,
    agent_id: agentId,
    started_at: startedAt,
    spans,
    source: {
      system: "arize",
      external_id: traceId,
    },
  };

  // Map only observable, non-hidden fields:
  if (raw.ended_at !== undefined) artifact.ended_at = raw.ended_at;
  if (raw.task_type !== undefined) artifact.task_type = raw.task_type;
  if (raw.user_input !== undefined) artifact.user_input = raw.user_input;
  if (raw.final_output !== undefined) artifact.final_output = raw.final_output;
  if (raw.declared_goal !== undefined) artifact.declared_goal = raw.declared_goal;
  if (raw.agent_status !== undefined) artifact.agent_status = raw.agent_status;
  if (typeof raw.agent_confidence === "number") artifact.agent_confidence = raw.agent_confidence;

  // NOTE: system_prompt, chain_of_thought, internal_state, and any other
  // fields representing hidden actor context are never mapped. This is
  // intentional per the architecture constraint: artifact-level only.

  return artifact;
}

// ── HTTP helper types ─────────────────────────────────────────────────────

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

// ── Deps ──────────────────────────────────────────────────────────────────

export type ArizeTraceSourceDeps = {
  /** Injected fetch for tests. Defaults to global fetch. */
  httpGet?: FetchFn;
};

// ── Factory ───────────────────────────────────────────────────────────────

export function createArizeTraceSource(deps?: ArizeTraceSourceDeps): TraceSourceAdapter {
  const httpGet: FetchFn = deps?.httpGet ?? fetch;

  return {
    name: "arize",

    enabled(): boolean {
      return isArizeEnabled();
    },

    async listTraceArtifacts(input: {
      agent_id?: string;
      since?: string;
      limit?: number;
    }): Promise<RawTraceArtifact[]> {
      if (!isArizeEnabled()) {
        return [];
      }

      const projectId = process.env["ARIZE_PROJECT_ID"] ?? "";
      const apiKey = process.env["ARIZE_API_KEY"] ?? "";

      // Build query string from optional filters.
      const params = new URLSearchParams();
      params.set("project_id", projectId);
      if (input.agent_id !== undefined) params.set("agent_id", input.agent_id);
      if (input.since !== undefined) params.set("since", input.since);
      if (input.limit !== undefined) params.set("limit", String(input.limit));

      const url = `https://app.arize.com/v1/traces?${params.toString()}`;

      try {
        const response = await httpGet(url, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          return [];
        }

        const body = await response.json() as ArizeApiResponse;
        const records = body.data ?? [];
        return records.map(mapArizeRecord);
      } catch {
        // Network errors or parse failures → return empty, never throw.
        return [];
      }
    },
  };
}
