/**
 * Seed the configured audit store (MongoDB when MONGODB_ENABLED=true, else in-memory)
 * with the full dashboard dataset: the seed demo, the generated-traces field dataset,
 * and the live actor traces + their audit findings (incl. detection_source).
 *
 * Mirrors what the dashboard container builds in memory, but persists it so a
 * MongoDB-backed dashboard shows the same picture plus the live agent results.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   pnpm exec tsx scripts/seed-store.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryAuditMemory, createMongoAuditMemory } from "../lib/audit-memory/index.js";
import type { AuditMemoryAdapter } from "../lib/audit-memory/adapter.js";
import { allSeedArtifacts, agentProfiles } from "../lib/seeds/index.js";
import { createDemoAdapter } from "../lib/agent/demo-adapter.js";
import { runAudit } from "../lib/agent/auditor.js";
import { loadFieldDataset } from "../lib/runtime/field-dataset.js";
import { extractEvidenceKeywords } from "../lib/clusterer/evidence-keywords.js";
import { runClusterer } from "../lib/clusterer/clusterer.js";
import type { AuditArtifact } from "../lib/contracts/audit-artifact.js";
import type { AuditFinding } from "../lib/contracts/audit-finding.js";
import { validateAuditFinding } from "../lib/contracts/audit-finding.js";
import type { AgentProfile } from "../lib/contracts/agent-profile.js";
import type { DetectionSource } from "../lib/contracts/enums.js";

type FindingDraft = {
  task_id: string;
  agent_id: string;
  lens: string;
  failure_mode: string;
  severity: AuditFinding["severity"];
  confidence: number;
  evidence: string[];
  recommended_action: string;
  human_review_required: boolean;
  detection_source?: DetectionSource;
};

async function loadLiveTraces(memory: AuditMemoryAdapter): Promise<{ artifacts: number; findings: number }> {
  const dir = join(process.cwd(), "fixtures", "live-traces");
  const artifacts = JSON.parse(readFileSync(join(dir, "artifacts.json"), "utf8")) as AuditArtifact[];
  const drafts = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")) as FindingDraft[];
  const profiles = JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "agent-profiles.json"), "utf8")
  ) as AgentProfile[];

  await memory.saveAgentProfiles(profiles);
  await memory.saveArtifacts(artifacts);

  const taskType = new Map(artifacts.map((a) => [a.task_id, a.task_type]));
  const iso = new Date().toISOString();

  const findings: AuditFinding[] = drafts.map((d) => {
    const base: Omit<AuditFinding, "task_type" | "detection_source"> = {
      finding_id: randomUUID(),
      task_id: d.task_id,
      agent_id: d.agent_id,
      lens: d.lens,
      failure_mode: d.failure_mode,
      severity: d.severity,
      confidence: d.confidence,
      evidence: [...d.evidence],
      evidence_keywords: extractEvidenceKeywords(d.evidence),
      recommended_action: d.recommended_action,
      human_review_required: d.human_review_required,
      converted_to_eval: false,
      created_at: iso,
      updated_at: iso,
    };
    const tt = taskType.get(d.task_id);
    const finding: AuditFinding = {
      ...base,
      ...(tt !== undefined ? { task_type: tt } : {}),
      ...(d.detection_source !== undefined ? { detection_source: d.detection_source } : {}),
    };
    const v = validateAuditFinding(finding);
    if (!v.ok) throw new Error(`invalid live finding ${d.task_id}: ${v.errors.join("; ")}`);
    return finding;
  });

  await memory.saveFindings(findings);
  await runClusterer({ memory });
  return { artifacts: artifacts.length, findings: findings.length };
}

async function main(): Promise<void> {
  const usesMongo =
    process.env["MONGODB_ENABLED"] === "true" && Boolean(process.env["MONGODB_URI"]);
  const memory = usesMongo ? createMongoAuditMemory() : createInMemoryAuditMemory();

  console.log(`\nSeeding store: ${usesMongo ? "MongoDB" : "in-memory (NOT persisted — set MONGODB_ENABLED=true)"}\n`);

  // 1. Seed demo (offline demo adapter — never calls Gemini).
  await memory.saveArtifacts(allSeedArtifacts);
  await memory.saveAgentProfiles(agentProfiles);
  await runAudit({ artifacts: allSeedArtifacts, adapter: createDemoAdapter(), memory });

  // 2. Generated-traces field dataset.
  const field = await loadFieldDataset(memory);

  // 3. Live actor traces + audit findings.
  const live = await loadLiveTraces(memory);

  const allFindings = await memory.listFindings();
  const allClusters = await memory.listClusters();
  console.log(`  seed demo:        ${allSeedArtifacts.length} artifacts`);
  console.log(`  generated field:  ${field.artifact_count} artifacts, ${field.finding_count} findings`);
  console.log(`  live actors:      ${live.artifacts} artifacts, ${live.findings} findings`);
  console.log(`  -----`);
  console.log(`  TOTAL findings:   ${allFindings.length}`);
  console.log(`  TOTAL clusters:   ${allClusters.length}`);
  const agentSourced = allFindings.filter((f) => f.detection_source === "agent");
  console.log(`  agent-sourced findings (regex blind spots): ${agentSourced.length}`);
  console.log(`\n${usesMongo ? "Persisted to MongoDB. Run `pnpm dev` with MONGODB_ENABLED=true to view." : "(in-memory only)"}\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
