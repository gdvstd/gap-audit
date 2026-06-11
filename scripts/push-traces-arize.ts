/**
 * Push generated actor traces to Arize via the actor-sim OpenInference/OTLP exporter.
 * Reads fixtures/live-traces/raw-traces.json, maps each RawTraceArtifact to the
 * RunResult shape the exporter expects, and exports them.
 *
 * Requires ARIZE_SPACE_ID + ARIZE_API_KEY (export is a no-op without them).
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   pnpm exec tsx scripts/push-traces-arize.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createArizeExporter } from "../actor-sim/tracing.js";
import type { RunResult } from "../actor-sim/runner.js";
import type { RawSpan } from "../lib/normalizer/raw-trace.js";

type RawTrace = {
  agent_id: string;
  task_type?: string;
  user_input?: string;
  declared_goal?: string;
  final_output?: string;
  agent_status?: string;
  agent_confidence?: number;
  started_at: string;
  ended_at?: string;
  spans: RawSpan[];
};

const VALID_STATUS = new Set(["resolved", "failed", "needs_review", "blocked"]);

function toRunResult(t: RawTrace): RunResult {
  const status = t.agent_status !== undefined && VALID_STATUS.has(t.agent_status)
    ? (t.agent_status as RunResult["agent_status"])
    : "needs_review";
  return {
    agent_id: t.agent_id,
    task_type: t.task_type ?? "unknown",
    user_input: t.user_input ?? "",
    declared_goal: t.declared_goal ?? "",
    final_output: t.final_output ?? "",
    agent_status: status,
    agent_confidence: t.agent_confidence ?? 0.5,
    started_at: t.started_at,
    ended_at: t.ended_at ?? t.started_at,
    spans: t.spans,
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? join("fixtures", "live-traces");
  const traces = JSON.parse(
    readFileSync(join(process.cwd(), dir, "raw-traces.json"), "utf8")
  ) as RawTrace[];

  const mode = process.env["PHOENIX_API_KEY"]
    ? "phoenix"
    : process.env["ARIZE_SPACE_ID"] && process.env["ARIZE_API_KEY"]
      ? "arize"
      : "none";
  console.log(`\nPushing ${traces.length} traces — target=${mode}${mode === "none" ? " (no creds → no-op)" : ""}\n`);

  const exporter = createArizeExporter();
  for (const t of traces) {
    await exporter.exportRun(toRunResult(t));
    console.log(`  → ${t.agent_id} (${t.spans.length} spans) exported`);
  }

  // Give the SimpleSpanProcessor time to flush before the process exits.
  await new Promise((r) => setTimeout(r, 3000));
  const where =
    mode === "phoenix"
      ? "Check app.phoenix.arize.com → project from PHOENIX_PROJECT (the Phoenix MCP reads this)."
      : mode === "arize"
        ? "Check app.arize.com → project 'silentops-actors'."
        : "Set PHOENIX_API_KEY (track path) or ARIZE_SPACE_ID+ARIZE_API_KEY to actually send.";
  console.log(`\nDone. ${where}\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
