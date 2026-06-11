import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isAgentBuilderEnabled,
  createLocalWorkflowOrchestrator,
  createAgentBuilderOrchestrator,
  createWorkflowOrchestrator,
  type WorkflowExecute,
  type AgentBuilderTrigger,
  type RunAuditWorkflowInput,
} from "../workflow-orchestrator.js";

const SAMPLE_RESULT = { run_id: "local-run-1", finding_count: 3, finding_ids: ["f1", "f2", "f3"] };

function makeExecute(): { execute: WorkflowExecute; calls: RunAuditWorkflowInput[] } {
  const calls: RunAuditWorkflowInput[] = [];
  const execute: WorkflowExecute = async (input) => {
    calls.push(input);
    return { ...SAMPLE_RESULT };
  };
  return { execute, calls };
}

function cleanupEnv(): void {
  delete process.env["AGENT_BUILDER_ENABLED"];
  delete process.env["AGENT_BUILDER_APP_ID"];
}

describe("isAgentBuilderEnabled", () => {
  beforeEach(cleanupEnv);
  afterEach(cleanupEnv);

  it("is false when flag unset", () => {
    expect(isAgentBuilderEnabled()).toBe(false);
  });

  it("is false when flag true but no app id", () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    expect(isAgentBuilderEnabled()).toBe(false);
  });

  it("is true when flag true and app id set", () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    process.env["AGENT_BUILDER_APP_ID"] = "app-123";
    expect(isAgentBuilderEnabled()).toBe(true);
  });
});

describe("createLocalWorkflowOrchestrator", () => {
  it("always enabled and runs the executor, tagging orchestrator=local", async () => {
    const { execute, calls } = makeExecute();
    const orch = createLocalWorkflowOrchestrator(execute);
    expect(orch.name).toBe("local");
    expect(orch.enabled()).toBe(true);
    const result = await orch.runAuditWorkflow({ artifact_ids: ["a1"] });
    expect(result.run_id).toBe("local-run-1");
    expect(result.finding_count).toBe(3);
    expect(result.orchestrator).toBe("local");
    expect(calls).toEqual([{ artifact_ids: ["a1"] }]);
  });
});

describe("createAgentBuilderOrchestrator", () => {
  beforeEach(cleanupEnv);
  afterEach(cleanupEnv);

  it("falls back to local execution when not configured", async () => {
    const { execute } = makeExecute();
    const orch = createAgentBuilderOrchestrator({ execute });
    const result = await orch.runAuditWorkflow({});
    expect(result.orchestrator).toBe("local");
    expect(result.finding_count).toBe(3);
  });

  it("triggers Agent Builder then runs local audit when enabled", async () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    process.env["AGENT_BUILDER_APP_ID"] = "app-123";
    const { execute, calls } = makeExecute();
    const triggerCalls: RunAuditWorkflowInput[] = [];
    const trigger: AgentBuilderTrigger = async (input) => {
      triggerCalls.push(input);
      return { ok: true, run_id: "ab-run-99" };
    };
    const orch = createAgentBuilderOrchestrator({ execute, trigger });
    const result = await orch.runAuditWorkflow({ lenses: ["evidence-output"] });

    expect(triggerCalls).toEqual([{ lenses: ["evidence-output"] }]);
    expect(calls).toEqual([{ lenses: ["evidence-output"] }]);
    expect(result.orchestrator).toBe("agent-builder");
    // Agent Builder run id overrides the local run id.
    expect(result.run_id).toBe("ab-run-99");
    expect(result.finding_count).toBe(3);
  });

  it("keeps local run_id when Agent Builder returns no run id", async () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    process.env["AGENT_BUILDER_APP_ID"] = "app-123";
    const { execute } = makeExecute();
    const trigger: AgentBuilderTrigger = async () => ({ ok: true });
    const orch = createAgentBuilderOrchestrator({ execute, trigger });
    const result = await orch.runAuditWorkflow({});
    expect(result.orchestrator).toBe("agent-builder");
    expect(result.run_id).toBe("local-run-1");
  });

  it("falls back to local and surfaces a note when the trigger fails (non-fatal)", async () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    process.env["AGENT_BUILDER_APP_ID"] = "app-123";
    const { execute, calls } = makeExecute();
    const trigger: AgentBuilderTrigger = async () => ({ ok: false, error: "503 unavailable" });
    const orch = createAgentBuilderOrchestrator({ execute, trigger });
    const result = await orch.runAuditWorkflow({});

    // Audit still ran locally — failure is not swallowed but does not abort the audit.
    expect(calls.length).toBe(1);
    expect(result.orchestrator).toBe("local");
    expect(result.orchestration_note).toContain("agent-builder trigger failed");
    expect(result.orchestration_note).toContain("503 unavailable");
    expect(result.finding_count).toBe(3);
  });
});

describe("createWorkflowOrchestrator selector", () => {
  beforeEach(cleanupEnv);
  afterEach(cleanupEnv);

  it("returns local orchestrator when Agent Builder disabled", async () => {
    const { execute } = makeExecute();
    const orch = createWorkflowOrchestrator(execute);
    expect(orch.name).toBe("local");
  });

  it("returns agent-builder orchestrator when enabled", async () => {
    process.env["AGENT_BUILDER_ENABLED"] = "true";
    process.env["AGENT_BUILDER_APP_ID"] = "app-123";
    const { execute } = makeExecute();
    const trigger: AgentBuilderTrigger = async () => ({ ok: true, run_id: "ab-1" });
    const orch = createWorkflowOrchestrator(execute, { trigger });
    expect(orch.name).toBe("agent-builder");
    const result = await orch.runAuditWorkflow({});
    expect(result.run_id).toBe("ab-1");
  });
});
