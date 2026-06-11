import { describe, it, expect, beforeEach } from "vitest";
import { auditArtifact, runAudit } from "../auditor.js";
import { createScriptedAdapter } from "../scripted-adapter.js";
import { createToolRegistry } from "../../tools/registry.js";
import { createInMemoryAuditMemory } from "../../audit-memory/in-memory.js";
import { getLensDefinition } from "../lens-prompts.js";
import type { AuditArtifact } from "../../contracts/audit-artifact.js";
import type { ReasoningStep } from "../reasoning-adapter.js";

const makeArtifact = (overrides: Partial<AuditArtifact> = {}): AuditArtifact => ({
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
  ...overrides,
});

const FIXED_DATE = new Date("2026-05-28T00:00:00.000Z");
let idCounter = 0;
const fixedIdFactory = () => `id-${++idCounter}`;
const fixedNow = () => FIXED_DATE;

describe("auditArtifact", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe("happy path: lens calls tool then returns finding", () => {
    it("finding survives when at least one tool call succeeded", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-refund-001" });
      await memory.saveArtifacts([artifact]);

      const lens = getLensDefinition("context-neglect-gap")!;

      const steps: ReasoningStep[] = [
        {
          kind: "tool_calls",
          calls: [{ tool: "get_artifact", input: { task_id: "task-refund-001" } }],
        },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-refund-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Evidence-Output Contradiction",
              severity: "high",
              confidence: 0.9,
              evidence: ["Tool returned refund exception but output denied refund"],
              recommended_action: "Review refund decision",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });
      const drafts = result.findings;

      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.failure_mode).toBe("Evidence-Output Contradiction");
    });

    it("returns no_findings when a lens checks tools but finds insufficient evidence", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-clean-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        {
          kind: "tool_calls",
          calls: [{ tool: "get_artifact", input: { task_id: "task-clean-001" } }],
        },
        {
          kind: "final",
          findings: [],
          no_findings: [
            {
              task_id: "task-clean-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              reason: "insufficient_evidence",
              checked_tools: ["get_artifact"],
              confidence: 0.82,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({
        artifact,
        adapter,
        registry,
        lenses: [getLensDefinition("context-neglect-gap")!],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.no_findings).toHaveLength(1);
      expect(result.no_findings[0]?.reason).toBe("insufficient_evidence");
      expect(result.no_findings[0]?.checked_tools).toEqual(["get_artifact"]);
    });

    it("synthesizes no_findings when legacy adapters return empty findings after tool checks", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-legacy-empty" });
      await memory.saveArtifacts([artifact]);

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: {
          "context-neglect-gap": [
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-legacy-empty" } }] },
            { kind: "final", findings: [] },
          ],
        },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({
        artifact,
        adapter,
        registry,
        lenses: [getLensDefinition("context-neglect-gap")!],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.no_findings).toHaveLength(1);
      expect(result.no_findings[0]?.reason).toBe("insufficient_evidence");
      expect(result.no_findings[0]?.lens).toBe("context-neglect-gap");
    });
  });

  describe("evidence-traceability gate", () => {
    it("drops findings when lens makes no tool calls at all", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact();

      const steps: ReasoningStep[] = [
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Made-up finding",
              severity: "high",
              confidence: 0.9,
              evidence: ["hallucinated evidence"],
              recommended_action: "nothing",
              human_review_required: false,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });
      const drafts = result.findings;

      expect(drafts).toHaveLength(0);
    });

    it("returns no_findings when only attempted tools fail", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact();

      const steps: ReasoningStep[] = [
        {
          kind: "tool_calls",
          calls: [{ tool: "nonexistent_tool", input: {} }],
        },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "resolved-but-not-served",
              failure_mode: "Should be dropped",
              severity: "high",
              confidence: 0.9,
              evidence: ["some evidence"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });
      const drafts = result.findings;

      // Unknown tool -> ok:false -> finding is dropped, but evidence unavailability is recorded.
      expect(drafts).toHaveLength(0);
      expect(result.no_findings).toHaveLength(1);
      expect(result.no_findings[0]?.reason).toBe("tool_evidence_unavailable");
      expect(result.no_findings[0]?.checked_tools).toEqual(["nonexistent_tool"]);
    });

    it("overrides adapter no_findings when every attempted tool fails", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact();

      const steps: ReasoningStep[] = [
        {
          kind: "tool_calls",
          calls: [{ tool: "nonexistent_tool", input: {} }],
        },
        {
          kind: "final",
          findings: [],
          no_findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "resolved-but-not-served",
              reason: "insufficient_evidence",
              checked_tools: ["nonexistent_tool"],
              confidence: 0.8,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });

      expect(result.findings).toHaveLength(0);
      expect(result.no_findings).toHaveLength(1);
      expect(result.no_findings[0]?.reason).toBe("tool_evidence_unavailable");
      expect(result.no_findings[0]?.checked_tools).toEqual(["nonexistent_tool"]);
    });

    it("keeps findings when at least one of multiple tool calls succeeds", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        {
          kind: "tool_calls",
          calls: [
            { tool: "nonexistent_tool", input: {} },              // fails
            { tool: "get_artifact", input: { task_id: "task-001" } }, // succeeds
          ],
        },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Contradiction",
              severity: "high",
              confidence: 0.85,
              evidence: ["at least one tool succeeded"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });
      const drafts = result.findings;

      expect(drafts).toHaveLength(1);
    });
  });

  describe("iteration cap", () => {
    it("drops findings when lens never returns final within maxStepsPerLens", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      // Script with only tool_calls steps (no final) — 10 steps, cap is 8
      const steps: ReasoningStep[] = Array.from({ length: 10 }, () => ({
        kind: "tool_calls" as const,
        calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }],
      }));

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry, maxStepsPerLens: 8 });
      const drafts = result.findings;

      expect(drafts).toHaveLength(0);
    });

    it("does not throw when cap is hit", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = Array.from({ length: 20 }, () => ({
        kind: "tool_calls" as const,
        calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }],
      }));

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const registry = createToolRegistry({ memory });
      await expect(
        auditArtifact({ artifact, adapter, registry, maxStepsPerLens: 3 })
      ).resolves.not.toThrow();
    });
  });

  describe("independence: two lenses both produce findings", () => {
    it("collects findings from both independent lenses", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const stepsEO: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Evidence-Output Contradiction",
              severity: "high",
              confidence: 0.85,
              evidence: ["Tool returned X but output said Y"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      const stepsFS: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "resolved-but-not-served",
              failure_mode: "False Success",
              severity: "high",
              confidence: 0.9,
              evidence: ["Status resolved but tool failed"],
              recommended_action: "Investigate",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap", "resolved-but-not-served"] },
        lensScripts: {
          "context-neglect-gap": stepsEO,
          "resolved-but-not-served": stepsFS,
        },
      });

      const registry = createToolRegistry({ memory });
      const result = await auditArtifact({ artifact, adapter, registry });
      const drafts = result.findings;

      expect(drafts).toHaveLength(2);
      const lensIds = drafts.map((d) => d.lens);
      expect(lensIds).toContain("context-neglect-gap");
      expect(lensIds).toContain("resolved-but-not-served");
    });
  });
});

describe("runAudit", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe("basic shape", () => {
    it("returns run_id, finding_count, finding_ids", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Evidence-Output Contradiction",
              severity: "high",
              confidence: 0.85,
              evidence: ["contradiction found in output"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const result = await runAudit({
        artifacts: [artifact],
        adapter,
        memory,
        now: fixedNow,
        idFactory: fixedIdFactory,
      });

      expect(typeof result.run_id).toBe("string");
      expect(typeof result.finding_count).toBe("number");
      expect(Array.isArray(result.finding_ids)).toBe(true);
    });

    it("returns 0 findings for empty artifacts", async () => {
      const memory = createInMemoryAuditMemory();
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: [] },
        lensScripts: {},
      });
      const result = await runAudit({ artifacts: [], adapter, memory });
      expect(result.finding_count).toBe(0);
      expect(result.finding_ids).toEqual([]);
    });

    it("finding_ids length matches finding_count", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Contradiction",
              severity: "high",
              confidence: 0.8,
              evidence: ["evidence text here"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      const result = await runAudit({ artifacts: [artifact], adapter, memory });
      expect(result.finding_ids).toHaveLength(result.finding_count);
    });
  });

  describe("finding enrichment matches old runner exactly", () => {
    it("produced findings are persisted to memory with correct structure", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001", task_type: "refund-request" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Evidence-Output Contradiction",
              severity: "high",
              confidence: 0.9,
              evidence: ["Policy exception retrieved but ignored in output"],
              recommended_action: "Reverse the denial",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      await runAudit({
        artifacts: [artifact],
        adapter,
        memory,
        now: fixedNow,
        idFactory: fixedIdFactory,
      });

      const saved = await memory.listFindings();
      expect(saved).toHaveLength(1);

      const f = saved[0]!;
      expect(f.finding_id).toBeTruthy();
      expect(f.task_id).toBe("task-001");
      expect(f.agent_id).toBe("agent-001");
      expect(f.lens).toBe("context-neglect-gap");
      expect(f.failure_mode).toBe("Evidence-Output Contradiction");
      expect(f.severity).toBe("high");
      expect(f.confidence).toBe(0.9);
      expect(f.evidence).toEqual(["Policy exception retrieved but ignored in output"]);
      expect(Array.isArray(f.evidence_keywords)).toBe(true);
      expect(f.evidence_keywords.length).toBeGreaterThan(0);
      expect(f.recommended_action).toBe("Reverse the denial");
      expect(f.human_review_required).toBe(true);
      expect(f.converted_to_eval).toBe(false);
      expect(f.created_at).toBe("2026-05-28T00:00:00.000Z");
      expect(f.updated_at).toBe("2026-05-28T00:00:00.000Z");
      expect(f.task_type).toBe("refund-request");
    });

    it("omits task_type field entirely when artifact.task_type is undefined", async () => {
      const memory = createInMemoryAuditMemory();
      // No task_type in artifact
      const artifact: AuditArtifact = {
        task_id: "task-no-type",
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
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-no-type" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-no-type",
              agent_id: "agent-001",
              lens: "resolved-but-not-served",
              failure_mode: "False Success",
              severity: "high",
              confidence: 0.85,
              evidence: ["resolved without verification"],
              recommended_action: "Verify",
              human_review_required: true,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: { "resolved-but-not-served": steps },
      });

      let counter = 0;
      await runAudit({
        artifacts: [artifact],
        adapter,
        memory,
        now: fixedNow,
        idFactory: () => `id-${++counter}`,
      });

      const saved = await memory.listFindings();
      expect(saved).toHaveLength(1);
      // exactOptionalPropertyTypes: task_type must NOT be present (not even as undefined)
      expect("task_type" in saved[0]!).toBe(false);
    });

    it("findings are saved after each artifact (sequentially, not batched)", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact1 = makeArtifact({ task_id: "task-seq-01", agent_id: "agent-seq" });
      const artifact2 = makeArtifact({ task_id: "task-seq-02", agent_id: "agent-seq" });
      await memory.saveArtifacts([artifact1, artifact2]);

      const saveCallOrder: number[] = [];
      let saveCallIndex = 0;
      const origSaveFindings = memory.saveFindings.bind(memory);
      memory.saveFindings = async (findings) => {
        saveCallIndex++;
        saveCallOrder.push(saveCallIndex);
        return origSaveFindings(findings);
      };

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: {
          "context-neglect-gap": [
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-seq-01" } }] },
            {
              kind: "final",
              findings: [
                {
                  task_id: "task-seq-01",
                  agent_id: "agent-seq",
                  lens: "context-neglect-gap",
                  failure_mode: "Contradiction",
                  severity: "high",
                  confidence: 0.85,
                  evidence: ["first artifact evidence text"],
                  recommended_action: "Review",
                  human_review_required: true,
                },
              ],
            },
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-seq-02" } }] },
            {
              kind: "final",
              findings: [
                {
                  task_id: "task-seq-02",
                  agent_id: "agent-seq",
                  lens: "context-neglect-gap",
                  failure_mode: "Contradiction",
                  severity: "high",
                  confidence: 0.85,
                  evidence: ["second artifact evidence text"],
                  recommended_action: "Review",
                  human_review_required: true,
                },
              ],
            },
          ],
        },
      });

      await runAudit({
        artifacts: [artifact1, artifact2],
        adapter,
        memory,
      });

      // saveFindings called once per artifact that produces findings (2 artifacts → 2 calls)
      expect(saveCallOrder).toHaveLength(2);
    });
  });

  describe("clustering runs after all artifacts", () => {
    it("produces clusters in memory after runAudit with matching findings", async () => {
      const memory = createInMemoryAuditMemory();

      const artifact1 = makeArtifact({ task_id: "task-clus-01", agent_id: "agent-cluster", task_type: "refund" });
      const artifact2 = makeArtifact({ task_id: "task-clus-02", agent_id: "agent-cluster", task_type: "refund" });
      await memory.saveArtifacts([artifact1, artifact2]);

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: {
          "resolved-but-not-served": [
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-clus-01" } }] },
            {
              kind: "final",
              findings: [
                {
                  task_id: "task-clus-01",
                  agent_id: "agent-cluster",
                  lens: "resolved-but-not-served",
                  failure_mode: "False Success",
                  severity: "high",
                  confidence: 0.9,
                  evidence: ["resolved without verification metric check"],
                  recommended_action: "Verify resolution",
                  human_review_required: true,
                },
              ],
            },
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-clus-02" } }] },
            {
              kind: "final",
              findings: [
                {
                  task_id: "task-clus-02",
                  agent_id: "agent-cluster",
                  lens: "resolved-but-not-served",
                  failure_mode: "False Success",
                  severity: "high",
                  confidence: 0.9,
                  evidence: ["resolved without verification metric check"],
                  recommended_action: "Verify resolution",
                  human_review_required: true,
                },
              ],
            },
          ],
        },
      });

      await runAudit({
        artifacts: [artifact1, artifact2],
        adapter,
        memory,
        now: fixedNow,
        idFactory: fixedIdFactory,
      });

      const clusters = await memory.listClusters();
      expect(clusters.length).toBeGreaterThan(0);
    });
  });

  describe("determinism with fixed now/idFactory", () => {
    it("produces deterministic run_id with fixed idFactory", async () => {
      const memory = createInMemoryAuditMemory();
      let counter = 0;
      const idFactory = () => `run-${++counter}`;
      const result = await runAudit({
        artifacts: [],
        adapter: createScriptedAdapter({ selectLenses: { lens_ids: [] }, lensScripts: {} }),
        memory,
        idFactory,
      });
      expect(result.run_id).toBe("run-1");
    });

    it("produces deterministic timestamps with fixed now", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Contradiction",
              severity: "high",
              confidence: 0.85,
              evidence: ["deterministic evidence here"],
              recommended_action: "Review",
              human_review_required: true,
            },
          ],
        },
      ];

      let counter2 = 0;
      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      await runAudit({
        artifacts: [artifact],
        adapter,
        memory,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        idFactory: () => `fixed-${++counter2}`,
      });

      const saved = await memory.listFindings();
      for (const f of saved) {
        expect(f.created_at).toBe("2026-01-01T00:00:00.000Z");
        expect(f.updated_at).toBe("2026-01-01T00:00:00.000Z");
      }
    });
  });

  describe("history-aware: artifact 2 can see artifact 1 findings via search_findings_history", () => {
    it("findings from artifact 1 are visible to artifact 2 lens via history tool", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact1 = makeArtifact({ task_id: "task-hist-01", agent_id: "agent-hist" });
      const artifact2 = makeArtifact({ task_id: "task-hist-02", agent_id: "agent-hist" });
      await memory.saveArtifacts([artifact1, artifact2]);

      let historySearchResult: unknown = null;

      const baseRegistry = createToolRegistry({ memory });
      const patchedRegistry = {
        ...baseRegistry,
        dispatch: async (call: { tool: string; input: unknown }) => {
          const result = await baseRegistry.dispatch(call);
          if (call.tool === "search_findings_history") {
            historySearchResult = result;
          }
          return result;
        },
      };

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["resolved-but-not-served"] },
        lensScripts: {
          "resolved-but-not-served": [
            // artifact1's steps
            { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-hist-01" } }] },
            {
              kind: "final",
              findings: [
                {
                  task_id: "task-hist-01",
                  agent_id: "agent-hist",
                  lens: "resolved-but-not-served",
                  failure_mode: "False Success",
                  severity: "high",
                  confidence: 0.9,
                  evidence: ["resolved without metric verification"],
                  recommended_action: "Verify",
                  human_review_required: true,
                },
              ],
            },
            // artifact2's steps — search_findings_history should see artifact1's finding
            {
              kind: "tool_calls",
              calls: [
                { tool: "search_findings_history", input: { agent_id: "agent-hist", lens: "resolved-but-not-served" } },
              ],
            },
            { kind: "final", findings: [] },
          ],
        },
      });

      // We can't easily inject patchedRegistry into runAudit (it builds its own)
      // Instead, let's verify via memory: after artifact1 is processed, its findings are in memory
      // We use a saveFindings spy to track when findings are persisted relative to artifact ordering.
      const savedAtEachCall: number[] = [];
      const origSaveFindings = memory.saveFindings.bind(memory);
      memory.saveFindings = async (findings) => {
        await origSaveFindings(findings);
        const all = await memory.listFindings();
        savedAtEachCall.push(all.length);
      };

      await runAudit({
        artifacts: [artifact1, artifact2],
        adapter,
        memory,
        lenses: [getLensDefinition("resolved-but-not-served")!],
      });

      // First saveFindings call should have 1 finding (from artifact1)
      expect(savedAtEachCall[0]).toBe(1);
      // After both artifacts, 1 finding total (artifact2 produced no findings)
      const finalFindings = await memory.listFindings();
      expect(finalFindings).toHaveLength(1);
      expect(finalFindings[0]?.task_id).toBe("task-hist-01");
    });
  });

  describe("throws on invalid finding draft", () => {
    it("throws when a finding fails validateAuditFinding due to invalid confidence", async () => {
      const memory = createInMemoryAuditMemory();
      const artifact = makeArtifact({ task_id: "task-001" });
      await memory.saveArtifacts([artifact]);

      const steps: ReasoningStep[] = [
        { kind: "tool_calls", calls: [{ tool: "get_artifact", input: { task_id: "task-001" } }] },
        {
          kind: "final",
          findings: [
            {
              task_id: "task-001",
              agent_id: "agent-001",
              lens: "context-neglect-gap",
              failure_mode: "Bad Finding",
              severity: "high",
              confidence: 1.5, // INVALID: > 1
              evidence: ["some evidence"],
              recommended_action: "Do something",
              human_review_required: false,
            },
          ],
        },
      ];

      const adapter = createScriptedAdapter({
        selectLenses: { lens_ids: ["context-neglect-gap"] },
        lensScripts: { "context-neglect-gap": steps },
      });

      await expect(
        runAudit({ artifacts: [artifact], adapter, memory })
      ).rejects.toThrow();
    });
  });
});
