import { createInMemoryAuditMemory } from "@/lib/audit-memory/index.js";
import { createMongoAuditMemory } from "@/lib/audit-memory/mongodb.js";
import { allSeedArtifacts, agentProfiles } from "@/lib/seeds/index.js";
import { runAudit, createAuditAdapter } from "@/lib/agent/index.js";
import { loadFieldDataset } from "@/lib/runtime/field-dataset.js";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter.js";

type Container = {
  memory: AuditMemoryAdapter;
  initialized: Promise<void>;
};

const globalForContainer = globalThis as unknown as { __silentOpsContainer?: Container };

function isMongoEnabled(): boolean {
  if (process.env["GAPAUDIT_MEMORY"] === "in-memory") return false;
  return (
    process.env["MONGODB_ENABLED"] === "true" &&
    typeof process.env["MONGODB_URI"] === "string" &&
    process.env["MONGODB_URI"] !== ""
  );
}

export function getContainer(): Container {
  if (globalForContainer.__silentOpsContainer === undefined) {
    const usesMongo = isMongoEnabled();

    // Always use in-memory adapter for the demo/seed path.
    // MongoDB mode skips seeding to avoid clobbering a real database.
    const memory: AuditMemoryAdapter = usesMongo
      ? createMongoAuditMemory()
      : createInMemoryAuditMemory();

    const initialized = (async () => {
      if (!usesMongo) {
        // Demo / local mode: seed artifacts and run audit pipeline.
        await memory.saveArtifacts(allSeedArtifacts);
        await memory.saveAgentProfiles(agentProfiles);
        const adapter = createAuditAdapter();
        await runAudit({ artifacts: allSeedArtifacts, adapter, memory });
        // Also load the real-agent (actor-sim) field dataset + its audited findings
        // so the dashboard shows audit results on genuine agent behavior offline.
        await loadFieldDataset(memory);
        // Mark all initially-loaded artifacts as swept so a subsequent
        // runAuditSweep call does not re-audit the seed/demo set.
        const allLoaded = await memory.listArtifacts();
        await memory.markAudited(allLoaded.map((a) => a.task_id));
      }
      // MongoDB mode: no auto-seeding. The real database is authoritative.
    })();

    globalForContainer.__silentOpsContainer = { memory, initialized };
  }
  return globalForContainer.__silentOpsContainer;
}

export async function getMemory(): Promise<AuditMemoryAdapter> {
  const c = getContainer();
  await c.initialized;
  return c.memory;
}
