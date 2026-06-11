/**
 * Ingest logic: pull live traces from a TraceSourceAdapter, normalize them,
 * and persist them in audit memory. Does NOT run audit lenses.
 */
import type { TraceSourceAdapter } from "@/lib/integrations/arize-adapter.js";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter.js";
import { normalizeRawTrace } from "@/lib/normalizer/normalize.js";

export type IngestInput = {
  agent_id?: string;
  since?: string;
  limit?: number;
};

export type IngestOutput = {
  run_id: string;
  ingested_count: number;
  artifact_ids: string[];
  note?: string;
};

export type IngestDeps = {
  traceSource: TraceSourceAdapter;
  memory: AuditMemoryAdapter;
  input: IngestInput;
};

function generateRunId(): string {
  return `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function runIngest(deps: IngestDeps): Promise<IngestOutput> {
  const { traceSource, memory, input } = deps;
  const run_id = generateRunId();

  if (!traceSource.enabled()) {
    return {
      run_id,
      ingested_count: 0,
      artifact_ids: [],
      note: "Trace source is disabled. Set ARIZE_ENABLED=true with valid credentials to enable live ingestion.",
    };
  }

  const traceInput: { agent_id?: string; since?: string; limit?: number } = {};
  if (input.agent_id !== undefined) traceInput.agent_id = input.agent_id;
  if (input.since !== undefined) traceInput.since = input.since;
  if (input.limit !== undefined) traceInput.limit = input.limit;

  const rawArtifacts = await traceSource.listTraceArtifacts(traceInput);

  const normalized = rawArtifacts.flatMap((raw) => {
    const result = normalizeRawTrace(raw);
    if (!result.ok) return [];
    return [result.value];
  });

  if (normalized.length > 0) {
    await memory.saveArtifacts(normalized);
  }

  return {
    run_id,
    ingested_count: normalized.length,
    artifact_ids: normalized.map((a) => a.task_id),
  };
}
