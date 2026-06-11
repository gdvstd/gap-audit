import { randomUUID } from "node:crypto";
import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { ReasoningAdapter } from "./reasoning-adapter.js";
import type { LensDefinition } from "./lens-prompts.js";
import { runAudit } from "./auditor.js";

export type AuditSweepResult = {
  run_id: string;
  audited_task_ids: string[];
  skipped_task_ids: string[];
  new_finding_count: number;
  finding_ids: string[];
};

/**
 * Autonomously audit all NEW (not-yet-swept) artifacts across ALL agents.
 *
 * Idempotent: re-running does not re-audit already-swept artifacts.
 * Clean artifacts (zero findings) are still marked swept so they are not
 * re-visited on the next call.
 */
export async function runAuditSweep(input: {
  memory: AuditMemoryAdapter;
  adapter: ReasoningAdapter;
  lenses?: LensDefinition[];
  now?: () => Date;
  idFactory?: () => string;
}): Promise<AuditSweepResult> {
  const { memory, adapter } = input;
  const makeId = input.idFactory ?? (() => randomUUID());

  const all = await memory.listArtifacts();
  const audited = new Set(await memory.listAuditedTaskIds());

  const fresh = all.filter((a) => !audited.has(a.task_id));
  const skipped_task_ids = all
    .filter((a) => audited.has(a.task_id))
    .map((a) => a.task_id);

  if (fresh.length === 0) {
    return {
      run_id: makeId(),
      audited_task_ids: [],
      skipped_task_ids,
      new_finding_count: 0,
      finding_ids: [],
    };
  }

  // Build runAudit input respecting exactOptionalPropertyTypes
  const runInput: Parameters<typeof runAudit>[0] = {
    artifacts: fresh,
    adapter,
    memory,
  };
  if (input.lenses !== undefined) {
    runInput.lenses = input.lenses;
  }
  if (input.now !== undefined) {
    runInput.now = input.now;
  }
  if (input.idFactory !== undefined) {
    runInput.idFactory = input.idFactory;
  }

  const auditResult = await runAudit(runInput);

  // Mark ALL fresh artifacts as swept, including those with zero findings,
  // so clean artifacts are not re-audited on the next sweep.
  await memory.markAudited(fresh.map((a) => a.task_id));

  return {
    run_id: auditResult.run_id,
    audited_task_ids: fresh.map((a) => a.task_id),
    skipped_task_ids,
    new_finding_count: auditResult.finding_count,
    finding_ids: auditResult.finding_ids,
  };
}
