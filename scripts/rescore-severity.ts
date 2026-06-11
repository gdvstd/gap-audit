#!/usr/bin/env tsx
/**
 * Recompute every finding's severity ALGORITHMICALLY (lib/scoring/severity.ts) — based on
 * failure-mode kind, evidence risk signals, and recurrence — then re-run the clusterer so
 * pattern severities (max of members) reflect the new labels. Replaces the LLM's severity
 * guess with a deterministic, reproducible label.
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/rescore-severity.ts
 */
import { computeSeverity } from "../lib/scoring/severity.js";
import { toFailureModeTag } from "../lib/clusterer/pattern-name.js";
import { runClusterer } from "../lib/clusterer/clusterer.js";
import { createMongoAuditMemory } from "../lib/audit-memory/index.js";
import type { AuditFinding } from "../lib/contracts/audit-finding.js";

function recurrenceKey(f: AuditFinding): string {
  return `${f.agent_id}|${f.lens}|${toFailureModeTag(f.failure_mode)}|${f.task_type ?? "unknown"}`;
}

async function main(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (uri === undefined || uri === "") throw new Error("MONGODB_URI not set");
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const findingsCol = client.db(dbName).collection("findings");

  const findings = (await findingsCol.find({}).toArray()) as unknown as AuditFinding[];

  // recurrence = number of findings sharing the same (agent, lens, failure_mode_tag, task_type)
  const recurrence = new Map<string, number>();
  for (const f of findings) recurrence.set(recurrenceKey(f), (recurrence.get(recurrenceKey(f)) ?? 0) + 1);

  const nowIso = new Date().toISOString();
  const dist: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let changed = 0;
  for (const f of findings) {
    const sev = computeSeverity(
      { lens: f.lens, failure_mode: f.failure_mode, evidence: f.evidence ?? [] },
      recurrence.get(recurrenceKey(f)) ?? 1
    );
    dist[sev] = (dist[sev] ?? 0) + 1;
    if (sev !== f.severity) {
      await findingsCol.updateOne({ finding_id: f.finding_id }, { $set: { severity: sev, updated_at: nowIso } });
      changed += 1;
    }
  }

  await client.close();
  console.log(`Rescored ${findings.length} findings (${changed} changed). Distribution:`, JSON.stringify(dist));

  // Re-run the clusterer so pattern severities reflect the new finding severities.
  const memory = createMongoAuditMemory();
  const res = await runClusterer({ memory });
  console.log(`Reclustered: ${res.cluster_count} clusters, ${res.updated_finding_count} findings re-tagged.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
