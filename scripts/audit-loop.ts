/**
 * Continuous local audit loop — demo/development alternative to Cloud Scheduler.
 *
 * Production: Cloud Scheduler → POST /api/audit/sweep every N minutes.
 * Local:      pnpm audit:loop [interval_seconds]
 *
 * Usage:
 *   pnpm audit:loop          # default 30s interval
 *   pnpm audit:loop 60       # 60s interval
 */
import { getMemory } from "../lib/runtime/container.js";
import { createAuditAdapter } from "../lib/agent/create-adapter.js";
import { sweepOnce } from "../lib/runtime/sweep-once.js";

const rawInterval = process.argv[2];
const intervalSeconds = rawInterval !== undefined && rawInterval !== "" ? parseInt(rawInterval, 10) : 30;
const intervalMs = (Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 30) * 1000;

async function main(): Promise<void> {
  console.log(`[audit-loop] starting — interval: ${intervalMs / 1000}s`);

  const memory = await getMemory();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const adapter = createAuditAdapter();
      const result = await sweepOnce(memory, adapter);
      console.log(
        `[sweep] audited ${result.audited_task_ids.length}, +${result.new_finding_count} findings, skipped ${result.skipped_task_ids.length}`
      );
    } catch (error: unknown) {
      console.error(`[sweep] error:`, error instanceof Error ? error.message : String(error));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
