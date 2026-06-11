#!/usr/bin/env tsx
/**
 * Backfill `phoenix_trace_id` on stored artifacts from the semantic->hex mapping that
 * actor-sim captured at push time (fixtures/live-traces/phoenix-map.json), so the
 * dashboard trace page can deep-link each artifact back to its trace in Arize Phoenix.
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/link-phoenix-traces.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (uri === undefined || uri === "") throw new Error("MONGODB_URI not set");
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";

  const mapPath = join(process.cwd(), "fixtures", "live-traces", "phoenix-map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>;
  const entries = Object.entries(map);
  console.log(`Loaded ${entries.length} semantic->phoenix mappings`);

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const artifacts = client.db(dbName).collection("artifacts");
    let matched = 0;
    let modified = 0;
    const unmatched: string[] = [];
    for (const [taskId, hex] of entries) {
      const res = await artifacts.updateOne({ task_id: taskId }, { $set: { phoenix_trace_id: hex } });
      matched += res.matchedCount;
      modified += res.modifiedCount;
      if (res.matchedCount === 0) unmatched.push(taskId);
    }
    console.log(`Artifacts matched: ${matched} / ${entries.length}  (modified: ${modified})`);
    if (unmatched.length > 0) {
      console.log(`No artifact for ${unmatched.length} task_ids (not seeded as artifacts):`);
      console.log("  " + unmatched.slice(0, 12).join(", "));
    }
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
