import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { ReasoningAdapter } from "../agent/reasoning-adapter.js";
import { runAuditSweep, type AuditSweepResult } from "../agent/sweep.js";

/**
 * Execute a single sweep iteration.
 *
 * Extracted as a pure-ish function so it can be unit-tested independently
 * of the infinite loop in audit-loop.ts.
 */
export async function sweepOnce(
  memory: AuditMemoryAdapter,
  adapter: ReasoningAdapter
): Promise<AuditSweepResult> {
  return runAuditSweep({ memory, adapter });
}
