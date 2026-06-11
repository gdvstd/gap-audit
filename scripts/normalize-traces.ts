/**
 * Normalize subagent-generated raw traces into GapAudit service artifacts using
 * the production mapper (lib/normalizer). Reads fixtures/generated-traces/raw-traces.json,
 * coerces any non-string span input/output to strings, normalizes + validates
 * each, writes the normalized artifacts, and prints a summary.
 *
 * Run: pnpm exec tsx scripts/normalize-traces.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRawTrace } from "../lib/normalizer/normalize.js";
import type { RawTraceArtifact } from "../lib/normalizer/raw-trace.js";

// Optional first arg: directory under the repo holding raw-traces.json
// (default: fixtures/generated-traces). Artifacts are written next to it.
const subdir = process.argv[2] ?? join("fixtures", "generated-traces");
const DIR = join(process.cwd(), subdir);

function coerce(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function coerceTrace(raw: Record<string, unknown>): RawTraceArtifact {
  const spans = Array.isArray(raw["spans"]) ? raw["spans"] : [];
  const coercedSpans = spans.map((s: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...s };
    if ("input" in s) out["input"] = coerce(s["input"]);
    if ("output" in s) out["output"] = coerce(s["output"]);
    return out;
  });
  return { ...(raw as object), spans: coercedSpans } as RawTraceArtifact;
}

const rawList = JSON.parse(readFileSync(join(DIR, "raw-traces.json"), "utf8")) as Record<string, unknown>[];

const artifacts = [];
let okCount = 0;
let failCount = 0;

console.log(`\nMapping ${rawList.length} generated traces into GapAudit service artifacts:\n`);

for (const raw of rawList) {
  const trace = coerceTrace(raw);
  const result = normalizeRawTrace(trace);
  if (!result.ok) {
    failCount += 1;
    console.log(`  FAIL  ${String(raw["trace_id"])}: ${result.errors.join("; ")}`);
    continue;
  }
  okCount += 1;
  const a = result.value;
  artifacts.push(a);
  const signalCount =
    (a.conversation_signals ?? []).length +
    (a.operational_signals ?? []).length +
    (a.business_signals ?? []).length;
  console.log(
    `  OK    ${a.task_id.padEnd(28)} agent=${a.agent_id.padEnd(22)} status=${a.agent_status.padEnd(12)} ` +
    `tools=${a.tool_facts.length} mem=${a.memory_writes.length} guard=${a.guardrail_events.length} ` +
    `verif=${(a.verification_artifacts ?? []).length} signals=${signalCount}`
  );
}

writeFileSync(join(DIR, "artifacts.json"), JSON.stringify(artifacts, null, 2));

console.log(`\nMapped ${okCount} OK, ${failCount} failed. Wrote ${artifacts.length} artifacts to ${join(subdir, "artifacts.json")}\n`);
