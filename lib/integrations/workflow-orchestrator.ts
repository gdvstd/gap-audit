// Workflow orchestration adapter (Google Cloud Agent Builder).
//
// Per plan/03-integrations.md, Agent Builder represents the orchestration layer for
// the audit workflow (lens routing, human-review handoff, external integrations). The
// app-native workflow (runAudit) always remains the substantive executor and the
// fallback. This adapter lets an audit run optionally trigger / be represented as an
// Agent Builder workflow run, while the actual finding production stays local.
//
// Gated by AGENT_BUILDER_ENABLED + AGENT_BUILDER_APP_ID (matches lib/runtime/adapter-status.ts).
// The live trigger is best-effort and non-fatal: if Agent Builder is unreachable, the
// audit still runs locally and the failure is surfaced (never silently swallowed).

export type RunAuditWorkflowInput = {
  artifact_ids?: string[];
  lenses?: string[];
};

export type RunAuditWorkflowResult = {
  run_id: string;
  finding_count: number;
  finding_ids: string[];
  orchestrator?: string;
  orchestration_note?: string;
};

// The local audit executor injected by the caller (app/api/audit/run/logic.ts).
export type WorkflowExecute = (
  input: RunAuditWorkflowInput
) => Promise<{ run_id: string; finding_count: number; finding_ids: string[] }>;

export type AgentBuilderTriggerResult =
  | { ok: true; run_id?: string }
  | { ok: false; error: string };

export type AgentBuilderTrigger = (
  input: RunAuditWorkflowInput
) => Promise<AgentBuilderTriggerResult>;

export type WorkflowOrchestratorAdapter = {
  name: string;
  enabled(): boolean;
  runAuditWorkflow(input: RunAuditWorkflowInput): Promise<RunAuditWorkflowResult>;
};

function isSet(key: string): boolean {
  return process.env[key] !== undefined && process.env[key] !== "";
}

export function isAgentBuilderEnabled(): boolean {
  return process.env["AGENT_BUILDER_ENABLED"] === "true" && isSet("AGENT_BUILDER_APP_ID");
}

// Best-effort default trigger. The exact Agent Builder endpoint/auth is deployment
// specific; this constructs a representative Vertex AI endpoint and is injected with a
// fake in tests. Never throws — failures are returned as { ok: false }.
const defaultAgentBuilderTrigger: AgentBuilderTrigger = async (input) => {
  try {
    const appId = process.env["AGENT_BUILDER_APP_ID"] ?? "";
    const project = process.env["GOOGLE_CLOUD_PROJECT"] ?? "";
    const location = process.env["GOOGLE_CLOUD_LOCATION"] ?? "global";
    const token = process.env["AGENT_BUILDER_TOKEN"];
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/agents/${appId}:run`;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token !== undefined && token !== "") {
      headers["authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ input }),
    });

    if (!res.ok) {
      return { ok: false, error: `agent builder responded ${String(res.status)}` };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const runId = data["run_id"];
    return typeof runId === "string" ? { ok: true, run_id: runId } : { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "agent builder trigger failed" };
  }
};

export function createLocalWorkflowOrchestrator(
  execute: WorkflowExecute
): WorkflowOrchestratorAdapter {
  return {
    name: "local",
    enabled(): boolean {
      return true;
    },
    async runAuditWorkflow(input: RunAuditWorkflowInput): Promise<RunAuditWorkflowResult> {
      const result = await execute(input);
      return { ...result, orchestrator: "local" };
    },
  };
}

export function createAgentBuilderOrchestrator(deps: {
  execute: WorkflowExecute;
  trigger?: AgentBuilderTrigger;
}): WorkflowOrchestratorAdapter {
  const trigger = deps.trigger ?? defaultAgentBuilderTrigger;
  return {
    name: "agent-builder",
    enabled: isAgentBuilderEnabled,
    async runAuditWorkflow(input: RunAuditWorkflowInput): Promise<RunAuditWorkflowResult> {
      // Fallback to local execution when Agent Builder is not configured.
      if (!isAgentBuilderEnabled()) {
        const result = await deps.execute(input);
        return { ...result, orchestrator: "local" };
      }

      // Trigger Agent Builder (best-effort) then run the substantive audit locally.
      const triggered = await trigger(input);
      const result = await deps.execute(input);

      if (!triggered.ok) {
        return {
          ...result,
          orchestrator: "local",
          orchestration_note: `agent-builder trigger failed: ${triggered.error}`,
        };
      }

      return {
        ...result,
        orchestrator: "agent-builder",
        ...(triggered.run_id !== undefined ? { run_id: triggered.run_id } : {}),
      };
    },
  };
}

// Selector: Agent Builder when enabled, otherwise the app-native local workflow.
export function createWorkflowOrchestrator(
  execute: WorkflowExecute,
  deps?: { trigger?: AgentBuilderTrigger }
): WorkflowOrchestratorAdapter {
  if (isAgentBuilderEnabled()) {
    return createAgentBuilderOrchestrator(
      deps?.trigger !== undefined ? { execute, trigger: deps.trigger } : { execute }
    );
  }
  return createLocalWorkflowOrchestrator(execute);
}
