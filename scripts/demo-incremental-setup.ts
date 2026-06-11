#!/usr/bin/env tsx
/**
 * Arrange the incremental-audit demo state: make exactly 5 traces "newly added"
 * (un-audited) with clear, varied failures, while everything else stays "already
 * audited". Run the local agent with a prompt to audit this new batch — it will
 * write 5 fresh findings that appear on the deployed dashboard.
 *
 *   - add Audit Artifacts (with phoenix_trace_id) for the 2 PII traces so findings bind
 *   - delete existing findings for 3 clear-failure traces so they read as un-audited
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/demo-incremental-setup.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRawTrace } from "../lib/normalizer/normalize.js";
import type { RawTraceArtifact } from "../lib/normalizer/raw-trace.js";

const NEW_PII = ["trace-pii-recruiting-001", "trace-pii-support-001"];
const RESET_FINDINGS = ["trace-gap-refund-001", "trace-gap-effort-repeat-info-001", "trace-gap-support-guardrail-001"];

function coerce(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v);
}
function coerceTrace(raw: Record<string, unknown>): RawTraceArtifact {
  const spans = Array.isArray(raw["spans"]) ? raw["spans"] : [];
  const coerced = spans.map((s: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...s };
    if ("input" in s) out["input"] = coerce(s["input"]);
    if ("output" in s) out["output"] = coerce(s["output"]);
    return out;
  });
  return { ...(raw as object), spans: coerced } as RawTraceArtifact;
}

async function main(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI not set");
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";

  const rawList = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "live-traces", "raw-traces.json"), "utf8")) as Record<string, unknown>[];
  const map = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "live-traces", "phoenix-map.json"), "utf8")) as Record<string, string>;

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const artifacts = db.collection("artifacts");
  const findings = db.collection("findings");

  // 1. Add artifacts for the 2 PII traces (with phoenix_trace_id), so findings bind.
  for (const taskId of NEW_PII) {
    const raw = rawList.find((r) => r["trace_id"] === taskId);
    if (!raw) { console.log(`  [skip] no raw trace for ${taskId}`); continue; }
    const result = normalizeRawTrace(coerceTrace(raw));
    if (!result.ok) { console.log(`  [FAIL] normalize ${taskId}: ${result.errors.join("; ")}`); continue; }
    const artifact = { ...result.value, ...(map[taskId] ? { phoenix_trace_id: map[taskId] } : {}) };
    await artifacts.updateOne({ task_id: taskId }, { $set: artifact }, { upsert: true });
    console.log(`  [artifact] upserted ${taskId} (phoenix_trace_id=${map[taskId]?.slice(0, 8)}…)`);
  }

  // 2. Delete existing findings for the 3 reset traces → they read as un-audited.
  for (const taskId of RESET_FINDINGS) {
    const res = await findings.deleteMany({ task_id: taskId });
    console.log(`  [reset] deleted ${res.deletedCount} finding(s) for ${taskId}`);
  }

  // 3. Report the resulting un-audited set among Phoenix traces.
  const withFindings = new Set(await findings.distinct("task_id"));
  const phoenixTaskIds = Object.keys(map);
  const unaudited = phoenixTaskIds.filter((t) => !withFindings.has(t));
  console.log(`\nUN-AUDITED (the "newly added" batch) — ${unaudited.length}:`);
  for (const t of unaudited) console.log(`  - ${t}`);
  console.log(`Total findings now: ${await findings.countDocuments()}`);

  await client.close();
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
