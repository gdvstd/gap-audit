import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../in-memory.js";
import type { AuditMemoryAdapter } from "../adapter.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { AgentProfile } from "../../contracts/agent-profile.js";

function makeProfile(agent_id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    agent_id,
    agent_name: `Agent ${agent_id}`,
    role: "support",
    allowed_actions: ["lookup", "respond"],
    restricted_actions: ["delete"],
    quality_principles: ["be accurate"],
    ...overrides,
  };
}

function makeArtifact(task_id: string, agent_id = "agent-1", overrides: Partial<AuditArtifact> = {}): AuditArtifact {
  return {
    task_id,
    agent_id,
    timestamp: "2026-05-01T00:00:00Z",
    user_input_summary: "test input",
    declared_goal: "test goal",
    final_output_summary: "test output",
    tool_facts: [],
    agent_status: "resolved",
    actions_taken: [],
    sensitive_entity_types: [],
    memory_writes: [],
    guardrail_events: [],
    ...overrides,
  };
}

describe("createInMemoryAuditMemory — Wave 1 additions", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  // ── saveAgentProfiles / getAgentProfile ──────────────────────────────────

  describe("saveAgentProfiles / getAgentProfile", () => {
    it("saves a single profile and retrieves it by agent_id", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1")]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result).not.toBeNull();
      expect(result?.agent_id).toBe("agent-1");
    });

    it("returns null when agent_id is not found", async () => {
      const result = await mem.getAgentProfile("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null before any profiles are saved", async () => {
      const result = await mem.getAgentProfile("agent-1");
      expect(result).toBeNull();
    });

    it("saves multiple profiles in one call", async () => {
      await mem.saveAgentProfiles([
        makeProfile("agent-1"),
        makeProfile("agent-2"),
      ]);
      const r1 = await mem.getAgentProfile("agent-1");
      const r2 = await mem.getAgentProfile("agent-2");
      expect(r1?.agent_id).toBe("agent-1");
      expect(r2?.agent_id).toBe("agent-2");
    });

    it("upserts by agent_id (second save overwrites first)", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "support" })]);
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "devops" })]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result?.role).toBe("devops");
    });

    it("saves empty array without throwing", async () => {
      await expect(mem.saveAgentProfiles([])).resolves.toBeUndefined();
    });

    it("cloning: mutating saved profile does not affect stored value", async () => {
      const p = makeProfile("agent-1", { role: "support" });
      await mem.saveAgentProfiles([p]);
      (p as { role: string }).role = "mutated";
      const result = await mem.getAgentProfile("agent-1");
      expect(result?.role).toBe("support");
    });

    it("cloning: mutating returned profile does not affect stored value", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1", { role: "support" })]);
      const result = await mem.getAgentProfile("agent-1");
      if (result) {
        (result as { role: string }).role = "mutated";
      }
      const result2 = await mem.getAgentProfile("agent-1");
      expect(result2?.role).toBe("support");
    });

    it("returns a different object reference each call", async () => {
      await mem.saveAgentProfiles([makeProfile("agent-1")]);
      const r1 = await mem.getAgentProfile("agent-1");
      const r2 = await mem.getAgentProfile("agent-1");
      expect(r1).not.toBe(r2);
    });

    it("preserves all profile fields exactly", async () => {
      const p = makeProfile("agent-1", {
        agent_name: "Support Bot",
        role: "support",
        allowed_actions: ["lookup", "respond", "escalate"],
        restricted_actions: ["delete", "modify_billing"],
        quality_principles: ["be accurate", "be concise"],
      });
      await mem.saveAgentProfiles([p]);
      const result = await mem.getAgentProfile("agent-1");
      expect(result).toEqual(p);
    });
  });

  // ── getArtifact ──────────────────────────────────────────────────────────

  describe("getArtifact", () => {
    it("returns null when task_id not found", async () => {
      const result = await mem.getArtifact("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null before any artifacts are saved", async () => {
      const result = await mem.getArtifact("task-1");
      expect(result).toBeNull();
    });

    it("retrieves a saved artifact by task_id", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const result = await mem.getArtifact("task-1");
      expect(result).not.toBeNull();
      expect(result?.task_id).toBe("task-1");
    });

    it("retrieves the correct artifact among multiple saved", async () => {
      await mem.saveArtifacts([
        makeArtifact("task-1", "agent-1"),
        makeArtifact("task-2", "agent-2"),
      ]);
      const result = await mem.getArtifact("task-2");
      expect(result?.agent_id).toBe("agent-2");
    });

    it("cloning: mutating saved artifact does not affect stored value", async () => {
      const a = makeArtifact("task-1", "agent-1");
      await mem.saveArtifacts([a]);
      (a as { declared_goal: string }).declared_goal = "mutated";
      const result = await mem.getArtifact("task-1");
      expect(result?.declared_goal).toBe("test goal");
    });

    it("cloning: mutating returned artifact does not affect stored value", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const result = await mem.getArtifact("task-1");
      if (result) {
        (result as { declared_goal: string }).declared_goal = "mutated";
      }
      const result2 = await mem.getArtifact("task-1");
      expect(result2?.declared_goal).toBe("test goal");
    });

    it("returns a different object reference each call", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const r1 = await mem.getArtifact("task-1");
      const r2 = await mem.getArtifact("task-1");
      expect(r1).not.toBe(r2);
    });

    it("upsert: re-saving with same task_id overwrites prior entry", async () => {
      await mem.saveArtifacts([makeArtifact("task-1", "agent-1")]);
      await mem.saveArtifacts([makeArtifact("task-1", "agent-2")]);
      const result = await mem.getArtifact("task-1");
      expect(result?.agent_id).toBe("agent-2");
    });
  });

  // ── listArtifacts ────────────────────────────────────────────────────────

  describe("listArtifacts", () => {
    it("returns empty array when no artifacts saved", async () => {
      const list = await mem.listArtifacts();
      expect(list).toEqual([]);
    });

    it("returns all artifacts when called with no argument", async () => {
      await mem.saveArtifacts([makeArtifact("task-1"), makeArtifact("task-2")]);
      const list = await mem.listArtifacts();
      expect(list).toHaveLength(2);
    });

    it("returns all artifacts when called with empty options object", async () => {
      await mem.saveArtifacts([makeArtifact("task-1"), makeArtifact("task-2")]);
      const list = await mem.listArtifacts({});
      expect(list).toHaveLength(2);
    });

    it("filters by agent_id", async () => {
      await mem.saveArtifacts([
        makeArtifact("task-1", "agent-1"),
        makeArtifact("task-2", "agent-2"),
        makeArtifact("task-3", "agent-1"),
      ]);
      const list = await mem.listArtifacts({ agent_id: "agent-1" });
      expect(list).toHaveLength(2);
      expect(list.every((a) => a.agent_id === "agent-1")).toBe(true);
    });

    it("returns empty array when agent_id filter matches nothing", async () => {
      await mem.saveArtifacts([makeArtifact("task-1", "agent-1")]);
      const list = await mem.listArtifacts({ agent_id: "agent-999" });
      expect(list).toEqual([]);
    });

    it("returns a fresh array each call", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const l1 = await mem.listArtifacts();
      const l2 = await mem.listArtifacts();
      expect(l1).not.toBe(l2);
    });

    it("cloning: mutating returned artifact does not affect internal store", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      const list = await mem.listArtifacts();
      if (list[0]) {
        (list[0] as { declared_goal: string }).declared_goal = "mutated";
      }
      const list2 = await mem.listArtifacts();
      expect(list2[0]?.declared_goal).toBe("test goal");
    });

    it("accumulates artifacts across multiple saveArtifacts calls", async () => {
      await mem.saveArtifacts([makeArtifact("task-1")]);
      await mem.saveArtifacts([makeArtifact("task-2")]);
      const list = await mem.listArtifacts();
      expect(list).toHaveLength(2);
    });
  });
});
