/**
 * Persistence for regression SUITES — one per Phoenix dataset, holding the judge prompt
 * that grades every example in that dataset. Stored in the `regression_suites` MongoDB
 * collection (the per-example RegressionEvalCases live in `eval_cases`).
 */
import type { RegressionSuite } from "../contracts/regression-eval-case.js";

function mongoEnabled(): boolean {
  return process.env["MONGODB_ENABLED"] === "true" && Boolean(process.env["MONGODB_URI"]);
}

async function withCollection<T>(fn: (col: import("mongodb").Collection) => Promise<T>): Promise<T> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env["MONGODB_URI"] as string);
  await client.connect();
  try {
    const db = client.db(process.env["MONGODB_DATABASE"] ?? "silentops");
    return await fn(db.collection("regression_suites"));
  } finally {
    await client.close();
  }
}

export async function listRegressionSuites(): Promise<RegressionSuite[]> {
  if (!mongoEnabled()) return [];
  return withCollection(async (col) => {
    const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
    return docs as unknown as RegressionSuite[];
  });
}

export async function getRegressionSuite(datasetName: string): Promise<RegressionSuite | null> {
  if (!mongoEnabled()) return null;
  return withCollection(async (col) => {
    const doc = await col.findOne({ dataset_name: datasetName }, { projection: { _id: 0 } });
    return (doc as unknown as RegressionSuite) ?? null;
  });
}

export async function upsertRegressionSuite(suite: RegressionSuite): Promise<void> {
  if (!mongoEnabled()) return;
  await withCollection(async (col) => {
    await col.updateOne({ dataset_name: suite.dataset_name }, { $set: suite }, { upsert: true });
  });
}

export async function bumpSuiteExampleCount(datasetName: string, phoenixDatasetId: string): Promise<void> {
  if (!mongoEnabled()) return;
  await withCollection(async (col) => {
    await col.updateOne(
      { dataset_name: datasetName },
      { $inc: { example_count: 1 }, $set: { phoenix_dataset_id: phoenixDatasetId, updated_at: new Date().toISOString() } }
    );
  });
}

/**
 * Force-sync MongoDB to Phoenix: delete any suite (and its eval_cases) whose dataset no
 * longer exists in Phoenix, and free the source findings (converted_to_eval -> false).
 * Phoenix is the source of truth. Pass the CURRENT list of Phoenix dataset names.
 */
export async function reconcileWithPhoenix(existingDatasetNames: string[]): Promise<{ removedSuites: string[]; removedCases: number }> {
  if (!mongoEnabled()) return { removedSuites: [], removedCases: 0 };
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env["MONGODB_URI"] as string);
  await client.connect();
  try {
    const db = client.db(process.env["MONGODB_DATABASE"] ?? "silentops");
    const keep = new Set(existingDatasetNames);
    const suites = await db.collection("regression_suites").find({}, { projection: { _id: 0, dataset_name: 1 } }).toArray();
    const orphans = suites.map((s) => s["dataset_name"] as string).filter((n) => !keep.has(n));
    if (orphans.length === 0) return { removedSuites: [], removedCases: 0 };

    const orphanCases = await db.collection("eval_cases").find({ dataset_name: { $in: orphans } }, { projection: { _id: 0, source_finding_id: 1 } }).toArray();
    const findingIds = Array.from(new Set(orphanCases.map((e) => e["source_finding_id"] as string)));

    const delCases = await db.collection("eval_cases").deleteMany({ dataset_name: { $in: orphans } });
    await db.collection("regression_suites").deleteMany({ dataset_name: { $in: orphans } });

    // Free findings whose only eval case lived in a removed suite.
    for (const fid of findingIds) {
      const remaining = await db.collection("eval_cases").countDocuments({ source_finding_id: fid });
      if (remaining === 0) {
        await db.collection("findings").updateOne({ finding_id: fid }, { $set: { converted_to_eval: false, updated_at: new Date().toISOString() } });
      }
    }
    return { removedSuites: orphans, removedCases: delCases.deletedCount };
  } finally {
    await client.close();
  }
}
