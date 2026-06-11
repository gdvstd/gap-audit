/**
 * MongoDB audit memory adapter.
 *
 * Storage note: this adapter persists the GapAudit artifacts callers hand in.
 * Normalization maps trace data into a service-audit contract before this
 * boundary; this adapter does not redact, enrich, or reinterpret payloads.
 */
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { PatternCluster } from "../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../contracts/review-decision.js";
import type { RegressionEvalCase } from "../contracts/regression-eval-case.js";
import type { AuditMemoryAdapter } from "./adapter.js";

// ── enabled() helper ──────────────────────────────────────────────────────

function isMongoEnabled(): boolean {
  if (process.env["GAPAUDIT_MEMORY"] === "in-memory") return false;
  return (
    process.env["MONGODB_ENABLED"] === "true" &&
    typeof process.env["MONGODB_URI"] === "string" &&
    process.env["MONGODB_URI"] !== ""
  );
}

// ── Pure mapping functions ─────────────────────────────────────────────────
//
// toDoc: domain type -> Mongo document (plain object, deep-cloned).
// fromDoc: Mongo document -> domain type (strips _id, deep-clones).
//
// These are exported so unit tests can exercise them without Mongo.

export function toDoc<T extends object>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function fromDoc<T>(doc: Record<string, unknown>): T {
  const copy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete copy["_id"];
  return copy as T;
}

// ── Db type shim ──────────────────────────────────────────────────────────
// We import Db lazily to avoid loading the driver in demo/test mode.
// Declare only the surface we use so we can accept both the real Db and fakes.

type MongoCursor = {
  toArray(): Promise<Record<string, unknown>[]>;
};

type MongoCollection = {
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  find(filter: Record<string, unknown>): MongoCursor | Promise<MongoCursor>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<unknown>;
};

type MongoDb = {
  collection(name: string): MongoCollection;
};

type MongoConnectionCache = {
  key: string;
  dbPromise: Promise<MongoDb>;
};

const globalForMongo = globalThis as unknown as { __gapAuditMongoConnection?: MongoConnectionCache };

// ── Deps type ─────────────────────────────────────────────────────────────

export type MongoAuditMemoryDeps = {
  /** Injected for tests; production code calls this lazily via the real driver. */
  getDb?: () => Promise<MongoDb>;
};

// ── Default getDb (lazy real driver) ─────────────────────────────────────

async function defaultGetDb(): Promise<MongoDb> {
  // Lazy import: the mongodb driver is only loaded when actually needed.
  const { MongoClient } = await import("mongodb");
  const uri = process.env["MONGODB_URI"] ?? "";
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";
  const key = uri + "\n" + dbName;

  const cached = globalForMongo.__gapAuditMongoConnection;
  if (cached !== undefined && cached.key === key) {
    return cached.dbPromise;
  }

  let dbPromise!: Promise<MongoDb>;
  dbPromise = (async () => {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      return client.db(dbName) as unknown as MongoDb;
    } catch (error) {
      if (globalForMongo.__gapAuditMongoConnection?.dbPromise === dbPromise) {
        delete globalForMongo.__gapAuditMongoConnection;
      }
      throw error;
    }
  })();

  globalForMongo.__gapAuditMongoConnection = { key, dbPromise };
  return dbPromise;
}

// ── Collection helpers ────────────────────────────────────────────────────

async function upsertOne(
  col: MongoCollection,
  filterKey: string,
  filterValue: string,
  doc: Record<string, unknown>
): Promise<void> {
  await col.updateOne(
    { [filterKey]: filterValue },
    { $set: doc },
    { upsert: true }
  );
}

async function findAllMatching(
  col: MongoCollection,
  filter: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const cursor = await col.find(cleaned);
  return cursor.toArray();
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createMongoAuditMemory(deps?: MongoAuditMemoryDeps): AuditMemoryAdapter {
  const getDb: () => Promise<MongoDb> = deps?.getDb ?? defaultGetDb;

  return {
    name: "mongodb",

    enabled(): boolean {
      return isMongoEnabled();
    },

    // ── Agent profiles ───────────────────────────────────────────────────

    async saveAgentProfiles(profiles: AgentProfile[]): Promise<void> {
      const db = await getDb();
      const col = db.collection("agent_profiles");
      for (const profile of profiles) {
        await upsertOne(col, "agent_id", profile.agent_id, toDoc(profile));
      }
    },

    async getAgentProfile(agent_id: string): Promise<AgentProfile | null> {
      const db = await getDb();
      const col = db.collection("agent_profiles");
      const doc = await col.findOne({ agent_id });
      if (doc === null) return null;
      return fromDoc<AgentProfile>(doc);
    },

    // ── Artifacts ────────────────────────────────────────────────────────

    async saveArtifacts(artifacts: AuditArtifact[]): Promise<void> {
      const db = await getDb();
      const col = db.collection("artifacts");
      for (const artifact of artifacts) {
        await upsertOne(col, "task_id", artifact.task_id, toDoc(artifact));
      }
    },

    async getArtifact(task_id: string): Promise<AuditArtifact | null> {
      const db = await getDb();
      const col = db.collection("artifacts");
      const doc = await col.findOne({ task_id });
      if (doc === null) return null;
      return fromDoc<AuditArtifact>(doc);
    },

    async listArtifacts(input?: { agent_id?: string }): Promise<AuditArtifact[]> {
      const db = await getDb();
      const col = db.collection("artifacts");
      const filter: Record<string, unknown> = {};
      if (input?.agent_id !== undefined) filter["agent_id"] = input.agent_id;
      const docs = await findAllMatching(col, filter);
      return docs.map((d) => fromDoc<AuditArtifact>(d));
    },

    // ── Findings ─────────────────────────────────────────────────────────

    async saveFindings(findings: AuditFinding[]): Promise<void> {
      const db = await getDb();
      const col = db.collection("findings");
      for (const finding of findings) {
        await upsertOne(col, "finding_id", finding.finding_id, toDoc(finding));
      }
    },

    async listFindings(
      input?: { agent_id?: string; severity?: AuditFinding["severity"] }
    ): Promise<AuditFinding[]> {
      const db = await getDb();
      const col = db.collection("findings");
      const filter: Record<string, unknown> = {};
      if (input?.agent_id !== undefined) filter["agent_id"] = input.agent_id;
      if (input?.severity !== undefined) filter["severity"] = input.severity;
      const docs = await findAllMatching(col, filter);
      return docs.map((d) => fromDoc<AuditFinding>(d));
    },

    // ── Review decisions ─────────────────────────────────────────────────

    async saveReviewDecision(decision: ReviewDecision): Promise<void> {
      const db = await getDb();
      const col = db.collection("review_decisions");
      await upsertOne(col, "finding_id", decision.finding_id, toDoc(decision));
    },

    async listReviewDecisions(input?: { finding_id?: string }): Promise<ReviewDecision[]> {
      const db = await getDb();
      const col = db.collection("review_decisions");
      const filter: Record<string, unknown> = {};
      if (input?.finding_id !== undefined) filter["finding_id"] = input.finding_id;
      const docs = await findAllMatching(col, filter);
      return docs.map((d) => fromDoc<ReviewDecision>(d));
    },

    // ── Eval cases ───────────────────────────────────────────────────────

    async saveEvalCase(evalCase: RegressionEvalCase): Promise<void> {
      const db = await getDb();
      const col = db.collection("eval_cases");
      await upsertOne(col, "eval_id", evalCase.eval_id, toDoc(evalCase));
    },

    async listEvalCases(
      input?: { agent_id?: string; source_finding_id?: string }
    ): Promise<RegressionEvalCase[]> {
      const db = await getDb();
      const col = db.collection("eval_cases");
      const filter: Record<string, unknown> = {};
      if (input?.agent_id !== undefined) filter["agent_id"] = input.agent_id;
      if (input?.source_finding_id !== undefined) filter["source_finding_id"] = input.source_finding_id;
      const docs = await findAllMatching(col, filter);
      return docs.map((d) => fromDoc<RegressionEvalCase>(d));
    },

    // ── Clusters ─────────────────────────────────────────────────────────

    async listClusters(): Promise<PatternCluster[]> {
      const db = await getDb();
      const col = db.collection("clusters");
      const docs = await findAllMatching(col, {});
      return docs.map((d) => fromDoc<PatternCluster>(d));
    },

    async saveClusters(clusters: PatternCluster[]): Promise<void> {
      const db = await getDb();
      const col = db.collection("clusters");
      for (const cluster of clusters) {
        await upsertOne(col, "cluster_id", cluster.cluster_id, toDoc(cluster));
      }
    },

    // ── updateFinding ─────────────────────────────────────────────────────────

    async updateFinding(
      finding_id: string,
      partial: Partial<Pick<AuditFinding, "cluster_id" | "converted_to_eval" | "updated_at" | "task_type">>
    ): Promise<AuditFinding> {
      const db = await getDb();
      const col = db.collection("findings");

      const existing = await col.findOne({ finding_id });
      if (existing === null) {
        throw new Error(`updateFinding: finding_id '${finding_id}' not found`);
      }

      // Strip Mongo's immutable _id from the existing doc before merging — otherwise
      // the upsert's $set would try to modify _id and Mongo rejects it.
      const base = toDoc(existing);
      delete base["_id"];
      const merged: Record<string, unknown> = { ...base, ...toDoc(partial as object) };
      await upsertOne(col, "finding_id", finding_id, merged);

      return fromDoc<AuditFinding>(merged);
    },

    // ── Swept task tracking ───────────────────────────────────────────────────

    async markAudited(task_ids: string[]): Promise<void> {
      const db = await getDb();
      const col = db.collection("swept");
      for (const task_id of task_ids) {
        await upsertOne(col, "task_id", task_id, { task_id });
      }
    },

    async listAuditedTaskIds(): Promise<string[]> {
      const db = await getDb();
      const col = db.collection("swept");
      const docs = await findAllMatching(col, {});
      return docs.map((d) => d["task_id"] as string);
    },
  };
}
