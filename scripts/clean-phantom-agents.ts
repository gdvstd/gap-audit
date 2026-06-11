/**
 * Remove phantom-agent records from MongoDB audit memory.
 *
 * A finding (or no_findings marker) describes the ACTOR agent it audited — never the
 * auditor itself. A live audit run once mislabeled some records with the auditor's own
 * identity ("GapAudit"), which surfaced as a phantom agent in the dashboard. This script
 * deletes those mislabeled records (auditor identity, or empty agent_id) from the
 * `findings` and `no_findings` collections. The root cause is fixed in
 * agent-builder/GapAudit/agent.py (_sanitize_actor_id) and app/page.tsx; this cleans data
 * written before that fix.
 *
 * Read-only-by-default: pass --apply to actually delete. Without it, just reports.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   pnpm exec tsx scripts/clean-phantom-agents.ts            # dry run (report only)
 *   pnpm exec tsx scripts/clean-phantom-agents.ts --apply    # delete
 */
import { MongoClient } from "mongodb";

const AUDITOR_IDENTITY = "GapAudit";
const COLLECTIONS = ["findings", "no_findings"] as const;

function normId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A record is a phantom if it has no actor agent_id, or is attributed to the auditor itself.
const PHANTOM_FILTER = {
  $or: [
    { agent_id: { $exists: false } },
    { agent_id: "" },
    { agent_id: null },
    // case/punctuation-insensitive match for the auditor identity ("GapAudit", "gap-audit", …)
    { agent_id: { $regex: `^\\s*gap[\\s_-]*audit\\s*$`, $options: "i" } },
  ],
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const uri = process.env["MONGODB_URI"];
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";

  if (uri === undefined || uri === "") {
    console.error("✗ MONGODB_URI is not set. Add it to .env.local and `export` it first.");
    process.exit(1);
  }

  const masked = uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  console.log(`Connecting to: ${masked}`);
  console.log(`Database:      ${dbName}`);
  console.log(`Mode:          ${apply ? "APPLY (will delete)" : "DRY RUN (report only)"}\n`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(dbName);

    for (const name of COLLECTIONS) {
      const col = db.collection(name);
      const matches = await col.find(PHANTOM_FILTER).toArray();
      if (matches.length === 0) {
        console.log(`✓ ${name}: no phantom-agent records.`);
        continue;
      }
      const sample = matches
        .slice(0, 5)
        .map((m) => `${String(m["task_id"] ?? "?")} (agent_id=${JSON.stringify(m["agent_id"] ?? null)})`)
        .join(", ");
      console.log(`• ${name}: ${matches.length} phantom record(s). e.g. ${sample}`);

      if (apply) {
        const res = await col.deleteMany(PHANTOM_FILTER);
        console.log(`  → deleted ${res.deletedCount} from ${name}.`);
      }
    }

    console.log(apply ? "\n✓ Cleanup complete." : "\nDry run only. Re-run with --apply to delete.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Failed: ${msg}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
