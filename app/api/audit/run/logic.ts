import { randomUUID } from "node:crypto";
import { allSeedArtifacts } from "@/lib/seeds/index.js";
import { allLensDefinitions } from "@/lib/agent/lens-prompts.js";
import { runAudit } from "@/lib/agent/auditor.js";
import { createAuditAdapter } from "@/lib/agent/create-adapter.js";
import { createWorkflowOrchestrator } from "@/lib/integrations/workflow-orchestrator.js";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter.js";

export type RunAuditRequest = {
  artifact_ids?: string[];
  lenses?: string[];
};

export type RunAuditResponse = {
  run_id: string;
  finding_count: number;
  finding_ids: string[];
  orchestrator?: string;
  orchestration_note?: string;
};

function parseBody(raw: unknown): { ok: true; value: RunAuditRequest } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;

  if ("artifact_ids" in obj && obj["artifact_ids"] !== undefined) {
    if (!Array.isArray(obj["artifact_ids"]) || !obj["artifact_ids"].every((v) => typeof v === "string")) {
      return { ok: false, error: "artifact_ids must be an array of strings" };
    }
  }
  if ("lenses" in obj && obj["lenses"] !== undefined) {
    if (!Array.isArray(obj["lenses"]) || !obj["lenses"].every((v) => typeof v === "string")) {
      return { ok: false, error: "lenses must be an array of strings" };
    }
  }

  const parsed: RunAuditRequest = {};
  if (Array.isArray(obj["artifact_ids"])) {
    parsed.artifact_ids = obj["artifact_ids"] as string[];
  }
  if (Array.isArray(obj["lenses"])) {
    parsed.lenses = obj["lenses"] as string[];
  }

  return { ok: true, value: parsed };
}

export async function runAuditRequest(
  memory: AuditMemoryAdapter,
  rawBody: unknown
): Promise<{ ok: true; value: RunAuditResponse } | { ok: false; status: number; error: string }> {
  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  // The substantive audit always runs locally (Gemini or demo reasoning agent).
  // The orchestrator wraps it: Agent Builder when enabled, else the app-native path.
  const execute = async (input: { artifact_ids?: string[]; lenses?: string[] }) => {
    const artifacts = input.artifact_ids !== undefined && input.artifact_ids.length > 0
      ? allSeedArtifacts.filter((a) => input.artifact_ids!.includes(a.task_id))
      : allSeedArtifacts;

    const runInput: Parameters<typeof runAudit>[0] = {
      artifacts,
      adapter: createAuditAdapter(),
      memory,
      idFactory: randomUUID,
    };

    if (input.lenses !== undefined && input.lenses.length > 0) {
      runInput.lenses = allLensDefinitions.filter((l) => input.lenses!.includes(l.id));
    }

    const result = await runAudit(runInput);
    return {
      run_id: result.run_id,
      finding_count: result.finding_count,
      finding_ids: result.finding_ids,
    };
  };

  const orchestrator = createWorkflowOrchestrator(execute);
  const result = await orchestrator.runAuditWorkflow(parsed.value);

  const value: RunAuditResponse = {
    run_id: result.run_id,
    finding_count: result.finding_count,
    finding_ids: result.finding_ids,
  };
  if (result.orchestrator !== undefined) {
    value.orchestrator = result.orchestrator;
  }
  if (result.orchestration_note !== undefined) {
    value.orchestration_note = result.orchestration_note;
  }

  return { ok: true, value };
}
