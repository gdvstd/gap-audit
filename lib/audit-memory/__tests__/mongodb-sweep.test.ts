/**
 * Tests for markAudited / listAuditedTaskIds — sweep tracking methods
 * added to the MongoDB adapter. Uses the existing fake-collection pattern.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMongoAuditMemory } from "../mongodb.js";
import type { AuditMemoryAdapter } from "../adapter.js";

// ── Fake collection double (mirrors mongodb.test.ts pattern) ─────────────────

type FakeDoc = Record<string, unknown>;

function makeFakeCollection(idField: string = "_no_default") {
  const store = new Map<string, FakeDoc>();

  return {
    _store: store,
    async findOne(filter: Record<string, unknown>): Promise<FakeDoc | null> {
      for (const doc of store.values()) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          return { ...doc };
        }
      }
      return null;
    },
    async find(filter: Record<string, unknown>): Promise<{ toArray(): Promise<FakeDoc[]> }> {
      const results: FakeDoc[] = [];
      for (const doc of store.values()) {
        const matches = Object.entries(filter).every(([k, v]) => {
          if (v === undefined) return true;
          return doc[k] === v;
        });
        if (matches) results.push({ ...doc });
      }
      return {
        toArray: async () => results.map((d) => ({ ...d })),
      };
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<void> {
      const upsert = options["upsert"] === true;
      const setDoc = (update["$set"] ?? {}) as FakeDoc;

      let foundKey: string | null = null;
      for (const [key, doc] of store.entries()) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          foundKey = key;
          break;
        }
      }

      if (foundKey !== null) {
        const existing = store.get(foundKey) ?? {};
        store.set(foundKey, { ...existing, ...setDoc });
      } else if (upsert) {
        const keyValue = (setDoc[idField] as string | undefined) ?? String(store.size + 1);
        store.set(keyValue, { ...setDoc });
      }
    },
  };
}

type FakeCollections = {
  agent_profiles: ReturnType<typeof makeFakeCollection>;
  artifacts: ReturnType<typeof makeFakeCollection>;
  findings: ReturnType<typeof makeFakeCollection>;
  review_decisions: ReturnType<typeof makeFakeCollection>;
  eval_cases: ReturnType<typeof makeFakeCollection>;
  clusters: ReturnType<typeof makeFakeCollection>;
  swept: ReturnType<typeof makeFakeCollection>;
};

function makeFakeDb(): FakeCollections & {
  collection(name: string): ReturnType<typeof makeFakeCollection>;
} {
  const cols: FakeCollections = {
    agent_profiles: makeFakeCollection("agent_id"),
    artifacts: makeFakeCollection("task_id"),
    findings: makeFakeCollection("finding_id"),
    review_decisions: makeFakeCollection("finding_id"),
    eval_cases: makeFakeCollection("eval_id"),
    clusters: makeFakeCollection("cluster_id"),
    swept: makeFakeCollection("task_id"),
  };
  return {
    ...cols,
    collection(name: string): ReturnType<typeof makeFakeCollection> {
      if (name === "agent_profiles") return cols.agent_profiles;
      if (name === "artifacts") return cols.artifacts;
      if (name === "findings") return cols.findings;
      if (name === "review_decisions") return cols.review_decisions;
      if (name === "eval_cases") return cols.eval_cases;
      if (name === "clusters") return cols.clusters;
      if (name === "swept") return cols.swept;
      throw new Error(`Unknown collection: ${name}`);
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createMongoAuditMemory — sweep tracking", () => {
  let db: ReturnType<typeof makeFakeDb>;
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    db = makeFakeDb();
    mem = createMongoAuditMemory({ getDb: () => Promise.resolve(db as unknown as import("mongodb").Db) });
  });

  describe("markAudited / listAuditedTaskIds", () => {
    it("returns empty array when nothing has been marked", async () => {
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toEqual([]);
    });

    it("marks a single task_id and lists it back", async () => {
      await mem.markAudited(["task-1"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toContain("task-1");
    });

    it("marks multiple task_ids in one call", async () => {
      await mem.markAudited(["task-1", "task-2", "task-3"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-2");
      expect(ids).toContain("task-3");
    });

    it("accumulates across multiple markAudited calls", async () => {
      await mem.markAudited(["task-1"]);
      await mem.markAudited(["task-2"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-2");
    });

    it("is idempotent: upsert prevents duplicates when marking same task_id twice", async () => {
      await mem.markAudited(["task-1"]);
      await mem.markAudited(["task-1"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids.filter((id) => id === "task-1")).toHaveLength(1);
    });

    it("handles empty array without throwing", async () => {
      await expect(mem.markAudited([])).resolves.toBeUndefined();
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toEqual([]);
    });

    it("markAudited returns void (Promise<void>)", async () => {
      const result = await mem.markAudited(["task-x"]);
      expect(result).toBeUndefined();
    });

    it("does not return _id field in listAuditedTaskIds", async () => {
      await mem.markAudited(["task-1"]);
      const ids = await mem.listAuditedTaskIds();
      // ids are plain strings, not objects
      for (const id of ids) {
        expect(typeof id).toBe("string");
      }
    });

    it("does not affect other collections (artifacts, findings, etc.)", async () => {
      await mem.markAudited(["task-1"]);
      const artifacts = await mem.listArtifacts();
      const findings = await mem.listFindings();
      expect(artifacts).toHaveLength(0);
      expect(findings).toHaveLength(0);
    });
  });
});
