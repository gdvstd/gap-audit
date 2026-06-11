/**
 * Actor runner — drives a real Gemini function-calling loop
 * and records RawSpan traces for every tool call.
 *
 * Dependency-injected GenerateFn keeps tests network-free.
 */

import type { RawSpan } from "../lib/normalizer/raw-trace.js";
import type { ActorAgent } from "./agents.js";
import { createToolRegistry } from "./tools/registry.js";
import type { ToolRegistry } from "./tools/registry.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FunctionCallShape = {
  name?: string;
  args?: Record<string, unknown>;
};

type GenerateResponseShape = {
  functionCalls?: FunctionCallShape[];
  text?: string;
};

export type GenerateRequest = {
  model: string;
  contents: unknown;
  config?: {
    systemInstruction?: string;
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description: string;
        parametersJsonSchema: unknown;
      }>;
    }>;
  };
};

export type GenerateResult = GenerateResponseShape;

export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult>;

export type RunOptions = {
  agent: ActorAgent;
  generate: GenerateFn;
  registry?: ToolRegistry;
  maxSteps?: number;
  /** Injected clock — returns ISO timestamp string; defaults to () => new Date().toISOString() */
  clock?: () => string;
  /** Injected trace_id; defaults to agent_id + timestamp */
  traceId?: string;
};

export type RunResult = {
  agent_id: string;
  task_type: string;
  service_metadata?: ActorAgent["service_metadata"];
  user_input: string;
  declared_goal: string;
  final_output: string;
  agent_status: "resolved" | "failed" | "needs_review" | "blocked";
  agent_confidence: number;
  started_at: string;
  ended_at: string;
  spans: RawSpan[];
};

// ─── Narrowing helpers ────────────────────────────────────────────────────────

function narrowGenerateResponse(raw: unknown): GenerateResponseShape {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;

  const result: GenerateResponseShape = {};

  if (Array.isArray(obj["functionCalls"])) {
    const arr = obj["functionCalls"] as unknown[];
    const narrowed = arr.filter(
      (c): c is FunctionCallShape => typeof c === "object" && c !== null
    );
    if (narrowed.length > 0) {
      result.functionCalls = narrowed;
    }
  }

  if (typeof obj["text"] === "string") {
    result.text = obj["text"];
  }

  return result;
}

function narrowArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function validAgentStatus(s: unknown): s is RunResult["agent_status"] {
  return (
    s === "resolved" || s === "failed" || s === "needs_review" || s === "blocked"
  );
}

// ─── Span-building helpers ────────────────────────────────────────────────────

/** Tools that should produce memory-kind spans */
const MEMORY_TOOLS = new Set(["write_memory", "write_eval_dataset", "update_crm", "log_note"]);

/** Tools that are action-type emitters */
const ACTION_TOOL_MAP: Record<string, string> = {
  draft_reply: "customer_reply",
  attempt_identifier_reply: "customer_reply",
  draft_email: "email_draft",
  post_to_channel: "channel_post",
  approve_payment: "payment_approval",
  update_status: "status_update",
  grant_access: "access_grant",
  request_approval: "approval_request",
  flag_for_review: "escalation",
  issue_refund: "refund",
  page_oncall: "escalation",
};

/** Visibility map for action tools */
const ACTION_VISIBILITY_MAP: Record<string, "internal" | "external"> = {
  draft_reply: "external",
  attempt_identifier_reply: "external",
  draft_email: "external",
  post_to_channel: "internal",
  approve_payment: "internal",
  update_status: "internal",
  grant_access: "internal",
  request_approval: "internal",
  flag_for_review: "internal",
  issue_refund: "internal",
  page_oncall: "internal",
};

/** Whether action is reversible */
const ACTION_REVERSIBLE_MAP: Record<string, boolean> = {
  draft_reply: false,
  attempt_identifier_reply: false,
  draft_email: true,
  post_to_channel: false,
  approve_payment: false,
  update_status: true,
  grant_access: true,
  request_approval: true,
  flag_for_review: true,
  issue_refund: false,
  page_oncall: false,
};

/** Tools with a specific target derived from args */
const ACTION_TARGET_MAP: Record<string, string> = {
  draft_reply: "customer",
  attempt_identifier_reply: "customer-reply-channel",
  page_oncall: "on_call_team",
};

function buildSpanId(prefix: string, step: number): string {
  return `${prefix}-step-${step}`;
}

function outputToString(output: string | Record<string, unknown>): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

function argsToInput(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

/**
 * Build a RawSpan for a tool call result.
 * Handles: memory, guardrail (blocked grant_access), verification (query_metrics), actions, and plain tool.
 */
function buildSpans(
  toolName: string,
  args: Record<string, unknown>,
  result: { status: "ok" | "error" | "blocked" | "partial"; output: string | Record<string, unknown> },
  step: number,
  clock: () => string
): RawSpan[] {
  const spanId = buildSpanId(toolName, step);
  const now = clock();
  const outputStr = outputToString(result.output);
  const inputStr = argsToInput(args);

  const spans: RawSpan[] = [];

  // Memory-kind tools
  if (MEMORY_TOOLS.has(toolName)) {
    const store =
      typeof args["store"] === "string"
        ? args["store"]
        : toolName === "update_crm"
        ? "crm_shared"
        : toolName === "log_note"
        ? "internal_notes"
        : "memory";

    const memSpan: RawSpan = {
      span_id: spanId,
      kind: "memory",
      name: toolName,
      start_time: now,
      status: result.status,
      input: inputStr,
      attributes: { store },
      output: outputStr,
    };

    // Attach retention metadata if present in args
    if (typeof args["retention_risk"] === "string") {
      memSpan.attributes = { ...memSpan.attributes, retention_risk: args["retention_risk"] };
    }
    if (Array.isArray(args["sensitive_entity_types"])) {
      const sensitiveEntityTypes = args["sensitive_entity_types"].filter(
        (item): item is string => typeof item === "string"
      );
      if (sensitiveEntityTypes.length > 0) {
        memSpan.attributes = {
          ...memSpan.attributes,
          sensitive_entity_types: sensitiveEntityTypes,
        };
      }
    }

    spans.push(memSpan);
    return spans;
  }

  // Blocked action tools with structured gate output emit both action and guardrail spans.
  if (result.status === "blocked") {
    const outputObj =
      typeof result.output === "object" && result.output !== null
        ? (result.output as Record<string, unknown>)
        : {};

    const gate =
      typeof outputObj["gate"] === "string" ? outputObj["gate"] : `${toolName}-gate`;
    const reason =
      typeof outputObj["reason"] === "string"
        ? outputObj["reason"]
        : `${toolName} blocked`;

    let target: string | undefined;
    if (typeof args["resource"] === "string") {
      target = args["resource"];
    } else if (typeof args["customer_id"] === "string") {
      target = "customer-reply-channel";
    }

    const attrs: Record<string, unknown> = {
      action_type: ACTION_TOOL_MAP[toolName] ?? toolName,
      visibility: ACTION_VISIBILITY_MAP[toolName] ?? "internal",
      reversible: ACTION_REVERSIBLE_MAP[toolName] ?? true,
    };
    if (target !== undefined) attrs["target"] = target;

    const toolSpan: RawSpan = {
      span_id: spanId,
      kind: "tool",
      name: toolName,
      start_time: now,
      status: result.status,
      input: inputStr,
      output: outputStr,
      attributes: attrs,
    };
    spans.push(toolSpan);

    const guardrailAttrs: Record<string, unknown> = { reason };
    if (typeof outputObj["count"] === "number") {
      guardrailAttrs["count"] = outputObj["count"];
    } else {
      guardrailAttrs["count"] = 1;
    }
    if (typeof outputObj["time_window"] === "string") {
      guardrailAttrs["time_window"] = outputObj["time_window"];
    }

    const guardrailSpan: RawSpan = {
      span_id: `${spanId}-guardrail`,
      kind: "guardrail",
      name: gate,
      start_time: now,
      attributes: guardrailAttrs,
      output: "blocked",
    };
    spans.push(guardrailSpan);
    return spans;
  }

  // query_metrics → tool span with verification attributes
  if (toolName === "query_metrics") {
    // Determine verification_status by checking if output indicates threshold exceeded
    const verificationStatus = outputStr.toLowerCase().includes("still elevated") ||
      outputStr.toLowerCase().includes("still above threshold") ||
      outputStr.toLowerCase().includes("above threshold") ||
      outputStr.toLowerCase().includes("recovery unconfirmed")
      ? "failed"
      : "passed";

    const toolSpan: RawSpan = {
      span_id: spanId,
      kind: "tool",
      name: toolName,
      start_time: now,
      status: result.status,
      input: inputStr,
      output: outputStr,
      attributes: {
        verification_type: "metric_recovery",
        verification_status: verificationStatus,
      },
    };
    spans.push(toolSpan);
    return spans;
  }

  // Action-type tools
  const actionType = ACTION_TOOL_MAP[toolName];
  if (actionType !== undefined) {
    const visibility = ACTION_VISIBILITY_MAP[toolName] ?? "internal";
    const reversible = ACTION_REVERSIBLE_MAP[toolName] ?? true;

    // Determine target: prefer args, then static map
    let target: string | undefined;
    if (typeof args["target"] === "string") {
      target = args["target"];
    } else if (typeof args["to"] === "string") {
      target = args["to"];
    } else if (typeof args["channel"] === "string") {
      target = args["channel"];
    } else if (typeof args["approver"] === "string") {
      target = args["approver"];
    } else if (typeof args["incident_id"] === "string") {
      target = args["incident_id"];
    } else if (typeof args["invoice_id"] === "string") {
      target = args["invoice_id"];
    } else {
      target = ACTION_TARGET_MAP[toolName];
    }

    const attrs: Record<string, unknown> = { action_type: actionType, visibility, reversible };
    if (target !== undefined) {
      attrs["target"] = target;
    }

    const toolSpan: RawSpan = {
      span_id: spanId,
      kind: "tool",
      name: toolName,
      start_time: now,
      status: result.status,
      input: inputStr,
      output: outputStr,
      attributes: attrs,
    };
    spans.push(toolSpan);
    return spans;
  }

  // Default: plain tool span
  const plainSpan: RawSpan = {
    span_id: spanId,
    kind: "tool",
    name: toolName,
    start_time: now,
    status: result.status,
    input: inputStr,
    output: outputStr,
  };
  spans.push(plainSpan);
  return spans;
}

// ─── Real GenerateFn builder ──────────────────────────────────────────────────

let cachedGenerateFn: GenerateFn | null = null;

export async function getRealGenerateFn(): Promise<GenerateFn> {
  if (cachedGenerateFn !== null) return cachedGenerateFn;

  const { GoogleGenAI } = (await import("@google/genai")) as {
    GoogleGenAI: new (opts: Record<string, unknown>) => {
      models: { generateContent: (req: GenerateRequest) => Promise<unknown> };
    };
  };

  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  const location = process.env["GOOGLE_CLOUD_LOCATION"];
  const apiKey = process.env["GEMINI_API_KEY"];

  const opts: Record<string, unknown> = {};
  if (project !== undefined && project !== "") {
    opts["vertexai"] = true;
    opts["project"] = project;
    if (location !== undefined && location !== "") {
      opts["location"] = location;
    }
  } else if (apiKey !== undefined && apiKey !== "") {
    opts["apiKey"] = apiKey;
  } else {
    throw new Error(
      "No Gemini credentials found. Set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY."
    );
  }

  const ai = new GoogleGenAI(opts);
  const fn: GenerateFn = async (req) => {
    const raw = await ai.models.generateContent(req);
    return narrowGenerateResponse(raw);
  };
  cachedGenerateFn = fn;
  return fn;
}

// ─── runActor ────────────────────────────────────────────────────────────────

export async function runActor(opts: RunOptions): Promise<RunResult> {
  const { agent, generate, maxSteps = 10 } = opts;
  const clock = opts.clock ?? (() => new Date().toISOString());
  const registry = opts.registry ?? createToolRegistry(agent.tools);

  const started_at = clock();

  // Conversation history in Gemini content format
  type GeminiContent = {
    role: "user" | "model";
    parts: Array<Record<string, unknown>>;
  };

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: agent.task }],
    },
  ];

  const spans: RawSpan[] = [];
  let stepCount = 0;

  let final_output = "";
  let agent_status: RunResult["agent_status"] = "failed";
  let agent_confidence = 0;
  let declared_goal = "";

  const functionDeclarations = registry.functionDeclarations;

  while (stepCount < maxSteps) {
    stepCount++;

    const raw = await generate({
      model: process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash",
      contents,
      config: {
        systemInstruction: agent.system_prompt,
        tools: [{ functionDeclarations }],
      },
    });

    const response = narrowGenerateResponse(raw);

    if (
      response.functionCalls === undefined ||
      response.functionCalls.length === 0
    ) {
      // Model returned text without function calls — treat as done
      final_output = response.text ?? "Agent completed without output.";
      agent_status = "failed";
      break;
    }

    // Process each function call
    const functionResponseParts: Array<Record<string, unknown>> = [];
    let terminated = false;

    for (const call of response.functionCalls) {
      const toolName = typeof call.name === "string" ? call.name : "";
      const args = narrowArgs(call.args);

      if (toolName === "submit_result") {
        // Terminal — extract result but don't emit a tool_fact span
        final_output =
          typeof args["final_output"] === "string" ? args["final_output"] : "Done.";
        if (validAgentStatus(args["status"])) {
          agent_status = args["status"];
        } else {
          agent_status = "failed";
        }
        agent_confidence =
          typeof args["confidence"] === "number" ? args["confidence"] : 0;
        declared_goal =
          typeof args["declared_goal"] === "string" ? args["declared_goal"] : "";
        terminated = true;

        // Still need to send a function response to complete the turn
        functionResponseParts.push({
          functionResponse: {
            name: "submit_result",
            response: { ok: true, data: "Task submitted." },
          },
        });
        break;
      }

      const result = registry.dispatch({ name: toolName, args });

      // Build spans for this tool call
      const newSpans = buildSpans(toolName, args, result, stepCount, clock);
      spans.push(...newSpans);

      // Build function response
      const responseData: Record<string, unknown> = { ok: result.status !== "error" };
      if (result.status !== "error") {
        responseData["data"] = result.output;
      } else {
        responseData["error"] = result.output;
      }

      functionResponseParts.push({
        functionResponse: {
          name: toolName,
          response: responseData,
        },
      });
    }

    // Append model turn (the function calls)
    contents.push({
      role: "model",
      parts: response.functionCalls.map((fc) => ({
        functionCall: { name: fc.name ?? "", args: fc.args ?? {} },
      })),
    });

    // Append user turn (function responses)
    if (functionResponseParts.length > 0) {
      contents.push({
        role: "user",
        parts: functionResponseParts,
      });
    }

    if (terminated) break;
  }

  const ended_at = clock();

  return {
    agent_id: agent.agent_id,
    task_type: agent.task_type,
    user_input: agent.task,
    declared_goal,
    final_output,
    agent_status,
    agent_confidence,
    started_at,
    ended_at,
    ...(agent.service_metadata !== undefined ? { service_metadata: agent.service_metadata } : {}),
    spans,
  };
}
