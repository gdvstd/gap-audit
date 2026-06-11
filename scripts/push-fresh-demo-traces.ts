#!/usr/bin/env tsx
/**
 * Push a small batch of demo "newly-added" traces to Phoenix RIGHT NOW so they become the
 * MOST RECENT traces in the project (OTel stamps spans with the current time). This makes
 * the live incremental-audit demo reliable: "audit the 3 most recent traces" will pick
 * exactly these un-audited failure traces, so the agent produces fresh findings.
 *
 * It also updates each artifact's phoenix_trace_id to the new trace, so the dashboard's
 * "open in Arize Phoenix" deep-link points at the fresh trace.
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/push-fresh-demo-traces.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createArizeExporter } from "../actor-sim/tracing.js";
import type { RunResult } from "../actor-sim/runner.js";
import type { RawSpan } from "../lib/normalizer/raw-trace.js";

const TARGETS = ["trace-pii-recruiting-001", "trace-pii-support-001", "trace-gap-refund-001"];

type RawTrace = {
  trace_id: string;
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
  const all = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "live-traces", "raw-traces.json"), "utf8")) as RawTrace[];

  // 0. Reset audit state: delete any findings / no_findings for the targets so they read
  //    as un-audited again (idempotent — safe to run before every take).
  const uri = process.env["MONGODB_URI"];
  if (uri) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(process.env["MONGODB_DATABASE"] ?? "silentops");
    const df = await db.collection("findings").deleteMany({ task_id: { $in: TARGETS } });
    let dnf = { deletedCount: 0 };
    try { dnf = await db.collection("no_findings").deleteMany({ task_id: { $in: TARGETS } }); } catch { /* collection may not exist */ }
    console.log(`  [reset] deleted ${df.deletedCount} finding(s) + ${dnf.deletedCount} no_findings marker(s) for the 3 targets`);
    await client.close();
  }

  const exporter = createArizeExporter();
  const newIds: Record<string, string> = {};
  for (const taskId of TARGETS) {
    const raw = all.find((t) => t.trace_id === taskId);
    if (!raw) { console.log(`  [skip] no raw trace ${taskId}`); continue; }
    const hex = await exporter.exportRun(toRunResult(raw), taskId);
    if (hex) { newIds[taskId] = hex; console.log(`  [pushed] ${taskId} -> ${hex}`); }
    else console.log(`  [FAIL] export ${taskId} (no hex — check PHOENIX env)`);
    await new Promise((r) => setTimeout(r, 600)); // keep ordering distinct
  }

  // Point each artifact's deep-link at the fresh trace.
  if (uri && Object.keys(newIds).length > 0) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri);
    await client.connect();
    const col = client.db(process.env["MONGODB_DATABASE"] ?? "silentops").collection("artifacts");
    for (const [taskId, hex] of Object.entries(newIds)) {
      await col.updateOne({ task_id: taskId }, { $set: { phoenix_trace_id: hex } });
    }
    await client.close();
    console.log(`\nUpdated phoenix_trace_id on ${Object.keys(newIds).length} artifact(s).`);
  }
  console.log("\nThese are now the most recent traces in Phoenix. Demo prompt:");
  console.log('  "Perform an auditing round on the 3 most recent traces from gap-audit-demo."');
}

main().catch((e) => { console.error(e); process.exit(1); });
