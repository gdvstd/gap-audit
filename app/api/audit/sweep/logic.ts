import { createAuditAdapter } from "@/lib/agent/create-adapter.js";
import { runAuditSweep } from "@/lib/agent/sweep.js";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter.js";

export type SweepResponse = {
  run_id: string;
  audited_task_ids: string[];
  skipped_task_ids: string[];
  new_finding_count: number;
  finding_ids: string[];
};

/**
 * Run an autonomous audit sweep against all unaudited artifacts.
 * No request body needed — the sweep is scope-autonomous.
 */
export async function runAuditSweepRequest(
  memory: AuditMemoryAdapter
): Promise<{ ok: true; value: SweepResponse } | { ok: false; status: number; error: string }> {
  try {
    const adapter = createAuditAdapter();
    const result = await runAuditSweep({ memory, adapter });

    return {
      ok: true,
      value: {
        run_id: result.run_id,
        audited_task_ids: result.audited_task_ids,
        skipped_task_ids: result.skipped_task_ids,
        new_finding_count: result.new_finding_count,
        finding_ids: result.finding_ids,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "sweep failed",
    };
  }
}
