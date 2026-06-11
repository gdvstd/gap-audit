/**
 * Show exactly what the auditor agent receives from get_artifact. Reads the
 * normalized service audit artifacts, writes agent-view.json, and prints the
 * service signal surface per artifact.
 *
 * Usage: pnpm exec tsx scripts/show-agent-view.ts [dir]   (default fixtures/live-traces)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditArtifact } from "../lib/contracts/audit-artifact.js";

const dir = process.argv[2] ?? join("fixtures", "live-traces");
const artifacts = JSON.parse(
  readFileSync(join(process.cwd(), dir, "artifacts.json"), "utf8")
) as AuditArtifact[];

writeFileSync(join(process.cwd(), dir, "agent-view.json"), JSON.stringify(artifacts, null, 2));

console.log(`\nAgent view (what get_artifact returns) for ${artifacts.length} artifacts:\n`);
for (const a of artifacts) {
  const signals = [
    ...(a.conversation_signals ?? []),
    ...(a.operational_signals ?? []),
    ...(a.business_signals ?? []),
  ];
  console.log(
    `  ${a.task_id.padEnd(28)} status=${a.agent_status.padEnd(12)} ` +
    `signals=${String(signals.length).padEnd(2)} context=${a.support_context === undefined ? "none" : "present"}`
  );
}
console.log(`\nWrote ${dir}/agent-view.json\n`);
