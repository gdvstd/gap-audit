/**
 * Converts RunResult -> RawTraceArtifact and exports to Arize via OpenInference OTel spans.
 *
 * Privacy by construction: never logs raw credential values.
 * Robust: never throws on export failure (logs to stderr and continues).
 */

import type { RawTraceArtifact } from "../lib/normalizer/raw-trace.js";
import type { RunResult } from "./runner.js";

// Privacy boundary lives on the AUDIT OUTPUT side (findings never contain raw values),
// NOT here. Traces are emitted RAW so the autonomous auditor reading them via Phoenix
// MCP can DETECT privacy-retention failures — you cannot audit for leaked PII that was
// masked away before it ever reached the trace store.

// ─── toRawTraceArtifact ───────────────────────────────────────────────────────

export type ToRawTraceOptions = {
  source?: "arize" | "other";
  traceId?: string;
};

export function toRawTraceArtifact(
  run: RunResult,
  opts?: ToRawTraceOptions
): RawTraceArtifact {
  const source = opts?.source ?? "other";
  const traceId =
    opts?.traceId !== undefined && opts.traceId !== ""
      ? opts.traceId
      : `${run.agent_id}-${run.started_at}`;

  const artifact: RawTraceArtifact = {
    trace_id: traceId,
    agent_id: run.agent_id,
    task_type: run.task_type,
    started_at: run.started_at,
    ended_at: run.ended_at,
    user_input: run.user_input,
    final_output: run.final_output,
    agent_status: run.agent_status,
    agent_confidence: run.agent_confidence,
    spans: run.spans,
    source: { system: source },
  };

  // Only set declared_goal if non-empty (exactOptionalPropertyTypes safe)
  if (run.declared_goal !== "") {
    artifact.declared_goal = run.declared_goal;
  }

  const service = run.service_metadata;
  if (service !== undefined) {
    // customer_input / customer_goal are NOT recorded on the trace — a real agent trace
    // only carries what was observed (input, task, output, spans). "Expected outcome" is a
    // JUDGMENT the audit agent derives (finding.expected_output), not trace data.
    if (service.company_task !== undefined) artifact.company_task = service.company_task;
    if (service.final_response !== undefined) artifact.final_response = service.final_response;
    if (service.conversation_signals !== undefined) artifact.conversation_signals = service.conversation_signals;
    if (service.operational_signals !== undefined) artifact.operational_signals = service.operational_signals;
    if (service.business_signals !== undefined) artifact.business_signals = service.business_signals;
    if (service.support_context !== undefined) {
      artifact.support_context = service.support_context as Record<string, unknown>;
    }
  }

  return artifact;
}

// ─── Arize exporter ───────────────────────────────────────────────────────────

export type ArizeExporter = {
  // Returns the OTel/Phoenix hex trace id assigned to this run, so the caller can map the
  // semantic task_id -> Phoenix trace id. Returns null when export is a no-op or fails.
  exportRun(run: RunResult, taskId: string): Promise<string | null>;
};

type TraceConfig = {
  mode: "phoenix" | "arize" | "none";
  endpoint: string;
  headers: Record<string, string>;
  projectName: string;
};

// Trace export targets, in priority order:
//   Phoenix MCP track path (PHOENIX_API_KEY) — the Arize-track-qualifying sink, so the
//     Phoenix MCP server can introspect these traces at runtime. Auth: Bearer; project
//     via the `openinference.project.name` resource attribute.
//   Arize AX (ARIZE_SPACE_ID + ARIZE_API_KEY) — fallback. Auth: space_id/api_key
//     headers; project via the `model_id` resource attribute.
function getTraceConfig(): TraceConfig {
  const projectName =
    process.env["PHOENIX_PROJECT"] ??
    process.env["ARIZE_PROJECT_ID"] ??
    process.env["ARIZE_MODEL_ID"] ??
    "silentops-actors";

  const phoenixKey = process.env["PHOENIX_API_KEY"];
  if (phoenixKey !== undefined && phoenixKey !== "") {
    const base =
      process.env["PHOENIX_COLLECTOR_ENDPOINT"] ?? "https://app.phoenix.arize.com/v1/traces";
    const endpoint = base.includes("/v1/traces")
      ? base
      : `${base.replace(/\/$/, "")}/v1/traces`;
    return {
      mode: "phoenix",
      endpoint,
      headers: { authorization: `Bearer ${phoenixKey}` },
      projectName,
    };
  }

  const spaceId = process.env["ARIZE_SPACE_ID"];
  const apiKey = process.env["ARIZE_API_KEY"];
  if (spaceId !== undefined && spaceId !== "" && apiKey !== undefined && apiKey !== "") {
    return {
      mode: "arize",
      endpoint: process.env["ARIZE_OTLP_ENDPOINT"] ?? "https://otlp.arize.com/v1/traces",
      headers: { space_id: spaceId, api_key: apiKey },
      projectName,
    };
  }

  return { mode: "none", endpoint: "", headers: {}, projectName };
}

function isArizeConfigured(): boolean {
  return getTraceConfig().mode !== "none";
}

export function createArizeExporter(): ArizeExporter {
  if (!isArizeConfigured()) {
    // No-op exporter
    return {
      async exportRun(_run: RunResult, _taskId: string): Promise<string | null> {
        // Arize credentials not set — skip silently
        return null;
      },
    };
  }

  return {
    async exportRun(run: RunResult, taskId: string): Promise<string | null> {
      try {
        const cfg = getTraceConfig();

        // Lazy-load OTel modules to keep import cost zero when unused
        const [
          { NodeTracerProvider, SimpleSpanProcessor },
          { OTLPTraceExporter },
          { resourceFromAttributes },
          { SpanKind, SpanStatusCode },
          { SemanticConventions, OpenInferenceSpanKind },
        ] = await Promise.all([
          import("@opentelemetry/sdk-trace-node") as Promise<{
            NodeTracerProvider: new (opts: unknown) => {
              register(): void;
              getTracer(name: string, version?: string): {
                startActiveSpan<T>(name: string, opts: unknown, fn: (span: {
                  setAttribute(k: string, v: unknown): void;
                  setStatus(s: { code: number; message?: string }): void;
                  spanContext(): { traceId: string };
                  end(): void;
                }) => T): T;
              };
              shutdown(): Promise<void>;
            };
            SimpleSpanProcessor: new (exporter: unknown) => unknown;
          }>,
          import("@opentelemetry/exporter-trace-otlp-proto") as Promise<{
            OTLPTraceExporter: new (opts: unknown) => unknown;
          }>,
          import("@opentelemetry/resources") as Promise<{
            resourceFromAttributes: (attrs: Record<string, unknown>) => unknown;
          }>,
          import("@opentelemetry/api") as Promise<{
            SpanKind: { INTERNAL: number; CLIENT: number };
            SpanStatusCode: { OK: number; ERROR: number };
          }>,
          import("@arizeai/openinference-semantic-conventions") as Promise<{
            SemanticConventions: {
              OPENINFERENCE_SPAN_KIND: string;
              INPUT_VALUE: string;
              OUTPUT_VALUE: string;
            };
            OpenInferenceSpanKind: { AGENT: string; TOOL: string };
          }>,
        ]);

        const exporter = new OTLPTraceExporter({
          url: cfg.endpoint,
          headers: cfg.headers,
        });

        // Project identifier differs by backend: Phoenix routes by the
        // openinference.project.name resource attribute; Arize AX requires model_id.
        const resourceAttrs: Record<string, unknown> = {
          "service.name": "actor-sim",
          "service.version": "1.0.0",
        };
        if (cfg.mode === "phoenix") {
          resourceAttrs["openinference.project.name"] = cfg.projectName;
        } else {
          resourceAttrs["model_id"] = cfg.projectName;
          resourceAttrs["model_version"] = "1.0.0";
        }
        const resource = resourceFromAttributes(resourceAttrs);

        const provider = new NodeTracerProvider({
          resource,
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });

        // Use the local provider's tracer directly — NOT the global trace API.
        // exportRun runs once per artifact; registering a global provider each time is
        // a no-op after the first call, which would route later exports to a stale,
        // already-shut-down provider and silently drop their spans.
        const tracer = provider.getTracer("actor-sim", "1.0.0");

        // Build root AGENT span; capture the OTel hex trace id (== Phoenix's traceId).
        const phoenixTraceId = await new Promise<string>((resolve) => {
          tracer.startActiveSpan(
            `agent:${run.agent_id}`,
            { kind: SpanKind.INTERNAL },
            (rootSpan) => {
              const traceHex = rootSpan.spanContext().traceId;
              rootSpan.setAttribute(
                SemanticConventions.OPENINFERENCE_SPAN_KIND,
                OpenInferenceSpanKind.AGENT
              );
              // Carry the semantic task_id so the auditor (reading via Phoenix MCP) keys
              // findings by the human-meaningful id, not the opaque hex trace id.
              rootSpan.setAttribute("silentops.task_id", taskId);
              rootSpan.setAttribute(SemanticConventions.INPUT_VALUE, run.user_input ?? "");
              rootSpan.setAttribute(SemanticConventions.OUTPUT_VALUE, run.final_output ?? "");

              // Export EVERY span (tool, memory, guardrail, verification, action) so the
              // auditor sees the full trace — including memory writes that retain PII and
              // guardrail blocks. Audit-relevant span attributes (store, retention_risk,
              // sensitive_entity_types, target, count, ...) ride along as silentops.* attrs.
              for (const span of run.spans) {
                tracer.startActiveSpan(
                  `${span.kind}:${span.name}`,
                  { kind: SpanKind.INTERNAL },
                  (childSpan) => {
                    childSpan.setAttribute(
                      SemanticConventions.OPENINFERENCE_SPAN_KIND,
                      OpenInferenceSpanKind.TOOL
                    );
                    childSpan.setAttribute("silentops.span_kind", span.kind);
                    childSpan.setAttribute("silentops.task_id", taskId);
                    if (span.input !== undefined) {
                      childSpan.setAttribute(SemanticConventions.INPUT_VALUE, span.input);
                    }
                    if (span.output !== undefined) {
                      childSpan.setAttribute(SemanticConventions.OUTPUT_VALUE, span.output);
                    }
                    if (span.attributes !== undefined) {
                      for (const [k, v] of Object.entries(span.attributes)) {
                        childSpan.setAttribute(
                          `silentops.${k}`,
                          typeof v === "string" ? v : JSON.stringify(v)
                        );
                      }
                    }
                    childSpan.setStatus({
                      code: span.status === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
                    });
                    childSpan.end();
                  }
                );
              }

              rootSpan.setStatus({ code: SpanStatusCode.OK });
              rootSpan.end();
              resolve(traceHex);
            }
          );
        });

        await provider.shutdown();
        return phoenixTraceId;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[actor-sim] trace export error: ${message}\n`);
        return null;
      }
    },
  };
}
