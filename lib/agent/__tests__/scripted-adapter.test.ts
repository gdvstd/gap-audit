import { describe, it, expect } from "vitest";
import { createScriptedAdapter } from "../scripted-adapter.js";
import { getLensDefinition } from "../lens-prompts.js";
import type { ReasoningStep } from "../reasoning-adapter.js";
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

describe("createScriptedAdapter", () => {
  describe("basic properties", () => {
    it("returns an adapter with default name when none provided", () => {
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      expect(typeof adapter.name).toBe("string");
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    it("uses provided name", () => {
      const adapter = createScriptedAdapter({
        name: "test-adapter",
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      expect(adapter.name).toBe("test-adapter");
    });

    it("enabled() returns true by default", () => {
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      expect(adapter.enabled()).toBe(true);
    });

    it("enabled() returns false when configured", () => {
      const adapter = createScriptedAdapter({
        enabled: false,
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      expect(adapter.enabled()).toBe(false);
    });
  });

  describe("selectLenses", () => {
    it("returns the configured lens_ids", async () => {
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served", "context-neglect-gap"] },
        lensScripts: {},
      });
      const result = await adapter.selectLenses({
        artifact: sampleArtifact,
        profile: null,
        lenses: [],
      });
      expect(result.lens_ids).toEqual(["resolved-but-not-served", "context-neglect-gap"]);
    });

    it("returns a clone (not the same reference)", async () => {
      const config = { lens_ids: ["resolved-but-not-served"] };
      const adapter = createScriptedAdapter({
        selectLenses: config,
        lensScripts: {},
      });
      const result = await adapter.selectLenses({
        artifact: sampleArtifact,
        profile: null,
        lenses: [],
      });
      expect(result).not.toBe(config);
    });

    it("returns empty lens_ids when configured with empty list", async () => {
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      const result = await adapter.selectLenses({
        artifact: sampleArtifact,
        profile: null,
        lenses: [],
      });
      expect(result.lens_ids).toEqual([]);
    });
  });

  describe("step - script replay", () => {
    it("replays steps in order for a lens", async () => {
      const lens = getLensDefinition("resolved-but-not-served")!;
      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        { kind: "final", findings: [] },
      ];
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      const step1 = await adapter.step({ lens, messages: [], tools: [] });
      expect(step1.kind).toBe("tool_calls");

      const step2 = await adapter.step({ lens, messages: [], tools: [] });
      expect(step2.kind).toBe("final");
    });

    it("returns final with empty findings when no script for lens", async () => {
      const lens = getLensDefinition("context-neglect-gap")!;
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });

      const step = await adapter.step({ lens, messages: [], tools: [] });
      expect(step.kind).toBe("final");
      if (step.kind === "final") {
        expect(step.findings).toEqual([]);
      }
    });

    it("returns final with empty findings when cursor exceeds script length", async () => {
      const lens = getLensDefinition("resolved-but-not-served")!;
      const steps: ReasoningStep[] = [
        { kind: "final", findings: [] },
      ];
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      await adapter.step({ lens, messages: [], tools: [] }); // consumes the script
      const extraStep = await adapter.step({ lens, messages: [], tools: [] }); // beyond end
      expect(extraStep.kind).toBe("final");
      if (extraStep.kind === "final") {
        expect(extraStep.findings).toEqual([]);
      }
    });

    it("maintains independent cursors per lens", async () => {
      const lensA = getLensDefinition("resolved-but-not-served")!;
      const lensB = getLensDefinition("context-neglect-gap")!;

      const stepsA: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: {} }] },
        { kind: "final", findings: [] },
      ];
      const stepsB: ReasoningStep[] = [
        { kind: "final", findings: [] },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served", "context-neglect-gap"] },
        lensScripts: {
          "resolved-but-not-served": stepsA,
          "context-neglect-gap": stepsB,
        },
      });

      // Advance lens A once
      const stepA1 = await adapter.step({ lens: lensA, messages: [], tools: [] });
      expect(stepA1.kind).toBe("tool_calls");

      // Lens B should still be at position 0
      const stepB1 = await adapter.step({ lens: lensB, messages: [], tools: [] });
      expect(stepB1.kind).toBe("final");

      // Lens A continues from position 1
      const stepA2 = await adapter.step({ lens: lensA, messages: [], tools: [] });
      expect(stepA2.kind).toBe("final");
    });

    it("returns the exact ReasoningStep from the script (tool_calls with correct calls)", async () => {
      const lens = getLensDefinition("resolved-but-not-served")!;
      const expectedCall = { tool: "get_artifact", input: { task_id: "task-xyz" } };
      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [expectedCall] },
      ];
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      const step = await adapter.step({ lens, messages: [], tools: [] });
      expect(step.kind).toBe("tool_calls");
      if (step.kind === "tool_calls") {
        expect(step.calls).toHaveLength(1);
        expect(step.calls[0]?.tool).toBe("get_artifact");
      }
    });

    it("can replay a 3-step sequence without issues", async () => {
      const lens = getLensDefinition("trust-damaging-service")!;
      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "t1" } }] },
        { kind: "tool_calls", calls: [{ tool: "detect_sensitive_entities", input: { text: "data" } }] },
        { kind: "final", findings: [
          {
            task_id: "t1",
            agent_id: "a1",
            lens: "trust-damaging-service",
            failure_mode: "Unsafe Retention",
            severity: "high",
            confidence: 0.85,
            evidence: ["detected phone number in trace"],
            recommended_action: "Redact and purge",
            human_review_required: true,
          }
        ] },
      ];
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["trust-damaging-service"] },
        lensScripts: { "trust-damaging-service": steps },
      });

      const s1 = await adapter.step({ lens, messages: [], tools: [] });
      expect(s1.kind).toBe("tool_calls");
      const s2 = await adapter.step({ lens, messages: [], tools: [] });
      expect(s2.kind).toBe("tool_calls");
      const s3 = await adapter.step({ lens, messages: [], tools: [] });
      expect(s3.kind).toBe("final");
      if (s3.kind === "final") {
        expect(s3.findings).toHaveLength(1);
      }
    });
  });
});
