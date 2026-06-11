import { describe, it, expect } from "vitest";
import { selectLensesForArtifact } from "../triage.js";
import { createScriptedAdapter } from "../scripted-adapter.js";
import { allLensDefinitions, getLensDefinition } from "../lens-prompts.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";

const sampleArtifact: AuditArtifact = {
  task_id: "task-001",
  agent_id: "agent-001",
  timestamp: "2026-05-01T00:00:00Z",
  user_input_summary: "test",
  declared_goal: "test",
  final_output_summary: "test",
  tool_facts: [],
  agent_status: "resolved",
  actions_taken: [],
  sensitive_entity_types: [],
  memory_writes: [],
  guardrail_events: [],
};

describe("selectLensesForArtifact", () => {
  it("returns the lenses that match the adapter's selected ids", async () => {
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: ["resolved-but-not-served", "context-neglect-gap"] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });
    const ids = result.map((l) => l.id);
    expect(ids).toContain("resolved-but-not-served");
    expect(ids).toContain("context-neglect-gap");
    expect(result).toHaveLength(2);
  });

  it("ignores unknown ids returned by the adapter", async () => {
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: ["resolved-but-not-served", "this-does-not-exist"] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("resolved-but-not-served");
  });

  it("returns empty array when adapter selects no lenses", async () => {
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: [] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });
    expect(result).toEqual([]);
  });

  it("returns lenses sorted by priority ascending", async () => {
    // Request them in reverse priority order.
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: ["operational-drift", "resolved-but-not-served", "context-neglect-gap"] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });
    const priorities = result.map((l) => l.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]!).toBeGreaterThan(priorities[i - 1]!);
    }
  });

  it("uses allLensDefinitions as default pool when no lenses param provided", async () => {
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: ["resolved-but-not-served"] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });
    const expected = getLensDefinition("resolved-but-not-served")!;
    expect(result[0]).toEqual(expected);
  });

  it("respects a custom lenses pool when provided", async () => {
    // Provide only a 2-lens pool
    const customPool = [getLensDefinition("resolved-but-not-served")!, getLensDefinition("context-neglect-gap")!];
    const adapter = createScriptedAdapter({
      // Adapter asks for trust-damaging-service which is not in pool
      selectLenses: { lens_ids: ["resolved-but-not-served", "trust-damaging-service"] },
      lensScripts: {},
    });
    const result = await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
      lenses: customPool,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("resolved-but-not-served");
  });

  it("passes the artifact and profile to the adapter selectLenses call", async () => {
    let capturedInput: { artifact: AuditArtifact; profile: null; lenses: typeof allLensDefinitions } | undefined;
    const adapter = createScriptedAdapter({
      selectLenses: { lens_ids: [] },
      lensScripts: {},
    });
    // Override selectLenses to capture params
    const origSelect = adapter.selectLenses.bind(adapter);
    adapter.selectLenses = async (input) => {
      capturedInput = input as typeof capturedInput;
      return origSelect(input);
    };

    await selectLensesForArtifact({
      artifact: sampleArtifact,
      profile: null,
      adapter,
    });

    expect(capturedInput?.artifact.task_id).toBe("task-001");
    expect(capturedInput?.profile).toBeNull();
  });
});
