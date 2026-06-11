/**
 * Audit generated/live GapAudit actor traces with the production pipeline:
 *   raw traces -> normalizer -> in-memory audit memory -> auditor (Gemini when
 *   GEMINI_ENABLED, else the offline demo adapter) -> findings + clusters.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-live.ts [path/to/raw-traces.json]
 *   (default: fixtures/live-traces/raw-traces.json)
 *
 * The offline demo adapter recognizes the seeded demo task_ids and the GapAudit
 * actor trace_ids. Use GEMINI_ENABLED=true with credentials for novel traces.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalizeRawTrace } from "../lib/normalizer/normalize.js";
import type { RawTraceArtifact } from "../lib/normalizer/raw-trace.js";
import type { AuditArtifact } from "../lib/contracts/audit-artifact.js";
import type { AuditFinding, LensFindingDraft } from "../lib/contracts/audit-finding.js";
import type { AgentProfile } from "../lib/contracts/agent-profile.js";
import { createInMemoryAuditMemory } from "../lib/audit-memory/index.js";
import { createAuditAdapter } from "../lib/agent/create-adapter.js";
import { runAudit } from "../lib/agent/auditor.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerce(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function coerceTrace(raw: Record<string, unknown>): RawTraceArtifact {
  const spans = Array.isArray(raw["spans"]) ? raw["spans"] : [];
  const coercedSpans = spans.map((span) => {
    const out: Record<string, unknown> = isRecord(span) ? { ...span } : {};
    if ("input" in out) out["input"] = coerce(out["input"]);
    if ("output" in out) out["output"] = coerce(out["output"]);
    return out;
  });
  return { ...raw, spans: coercedSpans } as RawTraceArtifact;
}

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function toFindingDraft(finding: AuditFinding): LensFindingDraft {
  const draft: LensFindingDraft = {
    task_id: finding.task_id,
    agent_id: finding.agent_id,
    lens: finding.lens,
    failure_mode: finding.failure_mode,
    severity: finding.severity,
    confidence: finding.confidence,
    evidence: [...finding.evidence],
    recommended_action: finding.recommended_action,
    human_review_required: finding.human_review_required,
  };
  if (finding.detection_source !== undefined) {
    draft.detection_source = finding.detection_source;
  }
  return draft;
}

function buildSummary(artifacts: AuditArtifact[], findings: AuditFinding[]): Record<string, unknown> {
  const findingTasks = new Set(findings.map((f) => f.task_id));
  const byLens: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const finding of findings) {
    inc(byLens, finding.lens);
    inc(byAgent, finding.agent_id);
    inc(bySeverity, finding.severity);
  }

  return {
    artifact_count: artifacts.length,
    finding_count: findings.length,
    clean_task_ids: artifacts
      .map((artifact) => artifact.task_id)
      .filter((taskId) => !findingTasks.has(taskId)),
    by_lens: byLens,
    by_agent: byAgent,
    by_severity: bySeverity,
  };
}

async function main(): Promise<void> {
  const tracesPath = process.argv[2] ?? join("fixtures", "live-traces", "raw-traces.json");
  const resolvedTracesPath = resolve(process.cwd(), tracesPath);
  const rawList = JSON.parse(readFileSync(resolvedTracesPath, "utf8")) as Record<string, unknown>[];
  const profiles = JSON.parse(
    readFileSync(resolve(process.cwd(), "fixtures", "agent-profiles.json"), "utf8")
  ) as AgentProfile[];

  const artifacts: AuditArtifact[] = [];
  for (const raw of rawList) {
    const result = normalizeRawTrace(coerceTrace(raw));
    if (result.ok) {
      artifacts.push(result.value);
    } else {
      console.error(`  normalize FAIL ${String(raw["trace_id"])}: ${result.errors.join("; ")}`);
    }
  }

  const memory = createInMemoryAuditMemory();
  await memory.saveAgentProfiles(profiles);
  await memory.saveArtifacts(artifacts);

  const adapter = createAuditAdapter();
  const geminiOn = process.env["GEMINI_ENABLED"] === "true";
  console.log(`\nAuditing ${artifacts.length} artifacts with adapter="${adapter.name}" (GEMINI_ENABLED=${String(geminiOn)})\n`);
  if (!geminiOn) {
    console.log("  NOTE: GEMINI_ENABLED is not true. The demo adapter recognizes seeded and");
    console.log("        GapAudit actor trace IDs; set GEMINI_ENABLED=true for novel traces.\n");
  }

  const run = await runAudit({ artifacts, adapter, memory, idFactory: () => randomUUID() });

  const findings = await memory.listFindings();
  const clusters = await memory.listClusters();
  const findingDrafts = findings.map(toFindingDraft);
  const summary = {
    run_id: run.run_id,
    cluster_count: clusters.length,
    no_finding_count: run.no_finding_count,
    ...buildSummary(artifacts, findings),
  };

  const outDir = dirname(resolvedTracesPath);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "artifacts.json"), JSON.stringify(artifacts, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "findings.json"), JSON.stringify(findingDrafts, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "no-findings.json"), JSON.stringify(run.no_findings, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "audit-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`run_id=${run.run_id}  findings=${run.finding_count}  no_findings=${run.no_finding_count}  clusters=${clusters.length}`);
  console.log(`wrote ${join(outDir, "artifacts.json")}`);
  console.log(`wrote ${join(outDir, "findings.json")}`);
  console.log(`wrote ${join(outDir, "no-findings.json")}`);
  console.log(`wrote ${join(outDir, "audit-summary.json")}\n`);

  for (const finding of findings) {
    console.log(`  [${finding.severity.toUpperCase()}] ${finding.lens} - ${finding.failure_mode}  (${finding.agent_id} / ${finding.task_id}, conf ${finding.confidence})`);
    for (const evidence of finding.evidence) console.log(`      - ${evidence}`);
  }
  console.log("");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
