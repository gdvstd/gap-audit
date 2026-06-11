import { describe, it, expect } from "vitest";
import {
  allLensDefinitions,
  mvpLensDefinitions,
  getLensDefinition,
} from "../lens-prompts.js";
import { createToolRegistry } from "../../tools/registry.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";

describe("lens-prompts", () => {
  describe("allLensDefinitions", () => {
    it("contains exactly 5 macro lenses", () => {
      expect(allLensDefinitions).toHaveLength(5);
    });

    it("all ids are unique", () => {
      const ids = allLensDefinitions.map((l) => l.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("contains all required lens ids", () => {
      const ids = new Set(allLensDefinitions.map((l) => l.id));
      expect(ids.has("resolved-but-not-served")).toBe(true);
      expect(ids.has("customer-effort-inflation")).toBe(true);
      expect(ids.has("trust-damaging-service")).toBe(true);
      expect(ids.has("context-neglect-gap")).toBe(true);
      expect(ids.has("operational-drift")).toBe(true);
    });

    it("priorities are sorted ascending (no two equal)", () => {
      const priorities = allLensDefinitions.map((l) => l.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]!).toBeGreaterThan(priorities[i - 1]!);
      }
    });

    it("every lens has a non-empty label", () => {
      for (const lens of allLensDefinitions) {
        expect(lens.label.length).toBeGreaterThan(0);
      }
    });

    it("every lens has a non-empty core_question", () => {
      for (const lens of allLensDefinitions) {
        expect(lens.core_question.length).toBeGreaterThan(0);
      }
    });

    it("every lens has a non-empty objective", () => {
      for (const lens of allLensDefinitions) {
        expect(lens.objective.length).toBeGreaterThan(0);
      }
    });

    it("every lens has a non-empty severity_guidance", () => {
      for (const lens of allLensDefinitions) {
        expect(lens.severity_guidance.length).toBeGreaterThan(0);
      }
    });

    it("every lens has at least one suggested tool", () => {
      for (const lens of allLensDefinitions) {
        expect(lens.suggested_tools.length).toBeGreaterThan(0);
      }
    });

    it("every suggested tool name exists in the tool registry schema names", () => {
      const memory = createInMemoryAuditMemory();
      const registry = createToolRegistry({ memory });
      const toolNames = new Set(registry.schemas.map((s) => s.name));

      for (const lens of allLensDefinitions) {
        for (const toolName of lens.suggested_tools) {
          expect(
            toolNames.has(toolName),
            `Lens '${lens.id}' references unknown tool '${toolName}'`
          ).toBe(true);
        }
      }
    });
  });

  describe("mvpLensDefinitions", () => {
    it("contains all 5 macro lenses", () => {
      expect(mvpLensDefinitions).toHaveLength(5);
    });

    it("contains the GapAudit macro lens set", () => {
      const ids = new Set(mvpLensDefinitions.map((l) => l.id));
      expect(ids.has("resolved-but-not-served")).toBe(true);
      expect(ids.has("customer-effort-inflation")).toBe(true);
      expect(ids.has("trust-damaging-service")).toBe(true);
      expect(ids.has("context-neglect-gap")).toBe(true);
      expect(ids.has("operational-drift")).toBe(true);
    });

    it("is sorted by priority", () => {
      const priorities = mvpLensDefinitions.map((l) => l.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]!).toBeGreaterThan(priorities[i - 1]!);
      }
    });
  });

  describe("getLensDefinition", () => {
    it("returns the lens for a known id", () => {
      const lens = getLensDefinition("resolved-but-not-served");
      expect(lens).toBeDefined();
      expect(lens?.id).toBe("resolved-but-not-served");
    });

    it("returns undefined for an unknown id", () => {
      expect(getLensDefinition("not-a-real-lens")).toBeUndefined();
    });

    it("returns the correct lens for each id", () => {
      const ids = [
        "resolved-but-not-served",
        "customer-effort-inflation",
        "trust-damaging-service",
        "context-neglect-gap",
        "operational-drift",
      ];
      for (const id of ids) {
        const lens = getLensDefinition(id);
        expect(lens).toBeDefined();
        expect(lens?.id).toBe(id);
      }
    });
  });

  describe("suggested_tools per lens", () => {
    it("context-neglect-gap suggests get_artifact and get_agent_profile", () => {
      const lens = getLensDefinition("context-neglect-gap")!;
      expect(lens.suggested_tools).toContain("get_artifact");
      expect(lens.suggested_tools).toContain("get_agent_profile");
    });

    it("trust-damaging-service suggests get_artifact and get_agent_profile (not detect_sensitive_entities)", () => {
      const lens = getLensDefinition("trust-damaging-service")!;
      expect(lens.suggested_tools).toContain("get_artifact");
      expect(lens.suggested_tools).toContain("get_agent_profile");
      expect(lens.suggested_tools).not.toContain("detect_sensitive_entities");
    });

    it("operational-drift suggests aggregate_guardrail_events and search_findings_history", () => {
      const lens = getLensDefinition("operational-drift")!;
      expect(lens.suggested_tools).toContain("aggregate_guardrail_events");
      expect(lens.suggested_tools).toContain("search_findings_history");
    });

    it("customer-effort-inflation suggests find_similar_findings", () => {
      const lens = getLensDefinition("customer-effort-inflation")!;
      expect(lens.suggested_tools).toContain("find_similar_findings");
    });

    it("operational-drift suggests search_findings_history and find_similar_findings", () => {
      const lens = getLensDefinition("operational-drift")!;
      expect(lens.suggested_tools).toContain("search_findings_history");
      expect(lens.suggested_tools).toContain("find_similar_findings");
    });

    it("operational-drift allows parallel pattern findings with canonical modes", () => {
      const lens = getLensDefinition("operational-drift")!;
      expect(lens.objective).toContain("parallel with a task-level finding");
      expect(lens.objective).toContain("latent-false-success-drift");
      expect(lens.objective).toContain("Guardrail Friction");
    });
  });
});
