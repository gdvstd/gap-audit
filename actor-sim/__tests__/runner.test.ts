/**
 * Tests for actor-sim runner.
 * Uses fake GenerateFn — no network calls.
 */

import { describe, it, expect } from "vitest";
import { runActor } from "../runner.js";
import type { GenerateResult, GenerateFn } from "../runner.js";
import type { ActorAgent } from "../agents.js";
import { createToolRegistry } from "../tools/registry.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<ActorAgent> = {}): ActorAgent {
  return {
    agent_id: "test-agent",
    task_type: "test",
    trace_id: "trace-test",
    system_prompt: "You are a test agent.",
    tools: ["lookup_account", "submit_result"],
    task: "Test task input.",
    ...overrides,
  };
}

/** Script a sequence of fake model responses. */
function makeScriptedGenerate(responses: GenerateResult[]): GenerateFn {
  let idx = 0;
  return async () => {
    const resp = responses[idx];
    if (resp === undefined) {
      return {
        functionCalls: [
          {
            name: "submit_result",
            args: { final_output: "Done.", status: "resolved", confidence: 0.5 },
          },
        ],
      };
    }
    idx++;
    return resp;
  };
}

// Fixed clock for deterministic tests
let clockTick = 0;
function makeClock(): () => string {
  return () => {
    const base = new Date("2026-06-04T10:00:00Z");
    base.setSeconds(base.getSeconds() + clockTick++);
    return base.toISOString();
  };
}

// ─── Basic happy path ─────────────────────────────────────────────────────────

describe("runActor - basic", () => {
  it("returns RunResult with correct agent_id and task_type", async () => {
    const agent = makeAgent();
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          {
            name: "submit_result",
            args: { final_output: "Done.", status: "resolved", confidence: 0.9 },
          },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });

    expect(result.agent_id).toBe("test-agent");
    expect(result.task_type).toBe("test");
    expect(result.user_input).toBe("Test task input.");
  });

  it("populates final_output, agent_status, agent_confidence from submit_result", async () => {
    const agent = makeAgent();
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          {
            name: "submit_result",
            args: {
              final_output: "Task is complete.",
              status: "needs_review",
              confidence: 0.75,
              declared_goal: "Test goal",
            },
          },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });

    expect(result.final_output).toBe("Task is complete.");
    expect(result.agent_status).toBe("needs_review");
    expect(result.agent_confidence).toBe(0.75);
    expect(result.declared_goal).toBe("Test goal");
  });

  it("sets started_at and ended_at using injected clock", async () => {
    clockTick = 0;
    const agent = makeAgent();
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "resolved", confidence: 0.5 } },
        ],
      },
    ]);

    const clock = makeClock();
    const result = await runActor({ agent, generate, clock });

    expect(result.started_at).toBeTruthy();
    expect(result.ended_at).toBeTruthy();
    // ended_at should be same or after started_at
    expect(new Date(result.ended_at) >= new Date(result.started_at)).toBe(true);
  });

  it("returns no tool spans when only submit_result is called", async () => {
    const agent = makeAgent();
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "resolved", confidence: 0.5 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    expect(result.spans).toHaveLength(0);
  });

  it("uses 'failed' status when model returns no function calls", async () => {
    const agent = makeAgent();
    const generate = makeScriptedGenerate([{ text: "Some text response" }]);

    const result = await runActor({ agent, generate });
    expect(result.agent_status).toBe("failed");
    expect(result.final_output).toBe("Some text response");
  });

  it("respects maxSteps limit", async () => {
    const agent = makeAgent({ tools: ["lookup_account", "submit_result"] });
    // Always returns a non-terminal tool call
    let step = 0;
    const generate: GenerateFn = async () => {
      step++;
      return {
        functionCalls: [{ name: "lookup_account", args: { account_name: "test" } }],
      };
    };

    const result = await runActor({ agent, generate, maxSteps: 3 });
    // After maxSteps (3), loop exits with failed status
    expect(result.agent_status).toBe("failed");
    expect(step).toBe(3);
  });
});

// ─── Span emission: plain tool ────────────────────────────────────────────────

describe("runActor - plain tool spans", () => {
  it("emits tool-kind span for lookup_account", async () => {
    const agent = makeAgent({ tools: ["lookup_account", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "lookup_account", args: { account_name: "Acme" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.8 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });

    const toolSpans = result.spans.filter((s) => s.kind === "tool");
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);

    const lookup = toolSpans.find((s) => s.name === "lookup_account");
    expect(lookup).toBeDefined();
    expect(lookup?.kind).toBe("tool");
    expect(lookup?.status).toBe("ok");
    expect(lookup?.output).toContain("Enterprise");
  });

  it("emits tool span with start_time", async () => {
    clockTick = 0;
    const clock = makeClock();
    const agent = makeAgent({ tools: ["lookup_account", "submit_result"] });
    const generate = makeScriptedGenerate([
      { functionCalls: [{ name: "lookup_account", args: { account_name: "X" } }] },
      { functionCalls: [{ name: "submit_result", args: { final_output: "y", status: "resolved", confidence: 0.5 } }] },
    ]);

    const result = await runActor({ agent, generate, clock });
    const span = result.spans.find((s) => s.name === "lookup_account");
    expect(span?.start_time).toBeTruthy();
    expect(() => new Date(span?.start_time ?? "")).not.toThrow();
  });
});

// ─── Memory spans ─────────────────────────────────────────────────────────────

describe("runActor - memory spans", () => {
  it("emits memory-kind span for write_memory", async () => {
    const agent = makeAgent({ tools: ["write_memory", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "write_memory", args: { store: "candidate_db", content: "Candidate data" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.9 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const memSpans = result.spans.filter((s) => s.kind === "memory");
    expect(memSpans.length).toBeGreaterThanOrEqual(1);

    const mem = memSpans.find((s) => s.name === "write_memory");
    expect(mem).toBeDefined();
    expect(mem?.attributes?.["store"]).toBe("candidate_db");
    expect(mem?.output).toContain("candidate_db");
  });

  it("emits memory-kind span for update_crm with store=crm_shared", async () => {
    const agent = makeAgent({ tools: ["update_crm", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "update_crm", args: { field: "contact", value: "Beth", store: "crm_shared" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.7 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const memSpans = result.spans.filter((s) => s.kind === "memory");
    expect(memSpans.length).toBeGreaterThanOrEqual(1);

    const crm = memSpans.find((s) => s.name === "update_crm");
    expect(crm?.attributes?.["store"]).toBe("crm_shared");
  });

  it("emits memory-kind span for log_note with store=internal_notes", async () => {
    const agent = makeAgent({ tools: ["log_note", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "log_note", args: { note: "Review flags", store: "internal_notes" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.6 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const logSpan = result.spans.find((s) => s.name === "log_note");
    expect(logSpan?.kind).toBe("memory");
    expect(logSpan?.attributes?.["store"]).toBe("internal_notes");
  });

  it("attaches retention_risk from args when provided", async () => {
    const agent = makeAgent({ tools: ["write_memory", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          {
            name: "write_memory",
            args: { store: "candidate_db", content: "candidate context", retention_risk: "high" },
          },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.8 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const mem = result.spans.find((s) => s.name === "write_memory");
    expect(mem?.attributes?.["retention_risk"]).toBe("high");
  });
});

// ─── Guardrail spans (blocked grant_access) ───────────────────────────────────

describe("runActor - guardrail spans", () => {
  it("emits guardrail span when grant_access is blocked", async () => {
    const agent = makeAgent({ tools: ["grant_access", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "grant_access", args: { user_name: "Jordan Lee", resource: "Revenue Analytics" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Blocked.", status: "blocked", confidence: 0.95 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const guardrailSpans = result.spans.filter((s) => s.kind === "guardrail");
    expect(guardrailSpans.length).toBeGreaterThanOrEqual(1);

    const guardrail = guardrailSpans[0];
    expect(guardrail).toBeDefined();
    expect(guardrail?.name).toBe("prod-data-access-gate");
    expect(guardrail?.attributes?.["reason"]).toContain("contractor");
    expect(guardrail?.attributes?.["count"]).toBe(1);
  });

  it("also emits tool span for the blocked grant_access call", async () => {
    const agent = makeAgent({ tools: ["grant_access", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "grant_access", args: { user_name: "Jordan Lee", resource: "Revenue Analytics" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Blocked.", status: "blocked", confidence: 0.95 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const toolSpan = result.spans.find((s) => s.kind === "tool" && s.name === "grant_access");
    expect(toolSpan).toBeDefined();
    expect(toolSpan?.status).toBe("blocked");
    expect(toolSpan?.attributes?.["action_type"]).toBe("access_grant");
  });

  it("guardrail span has output=blocked", async () => {
    const agent = makeAgent({ tools: ["grant_access", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "grant_access", args: { user_name: "Jordan Lee", resource: "Revenue Analytics" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Blocked.", status: "blocked", confidence: 0.95 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const guardrail = result.spans.find((s) => s.kind === "guardrail");
    expect(guardrail?.output).toBe("blocked");
  });
});

// ─── Verification spans (query_metrics) ───────────────────────────────────────

describe("runActor - verification spans", () => {
  it("emits tool span with verification_type=metric_recovery for query_metrics", async () => {
    const agent = makeAgent({ tools: ["query_metrics", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "query_metrics", args: { service_name: "payment-service" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Checked.", status: "needs_review", confidence: 0.4 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const verSpan = result.spans.find((s) => s.name === "query_metrics");
    expect(verSpan).toBeDefined();
    expect(verSpan?.kind).toBe("tool");
    expect(verSpan?.attributes?.["verification_type"]).toBe("metric_recovery");
    expect(verSpan?.attributes?.["verification_status"]).toBeDefined();
  });

  it("marks verification_status=failed when metrics still above threshold", async () => {
    const agent = makeAgent({ tools: ["query_metrics", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "query_metrics", args: { service_name: "payment-service" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "needs_review", confidence: 0.3 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const verSpan = result.spans.find((s) => s.name === "query_metrics");
    // The trap queryMetrics always returns "still elevated"
    expect(verSpan?.attributes?.["verification_status"]).toBe("failed");
  });
});

// ─── Action spans ─────────────────────────────────────────────────────────────

describe("runActor - action spans", () => {
  it("emits tool span with action_type for draft_reply", async () => {
    const agent = makeAgent({ tools: ["draft_reply", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "draft_reply", args: { content: "Hello", recipient: "customer" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "resolved", confidence: 0.8 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const actionSpan = result.spans.find((s) => s.name === "draft_reply");
    expect(actionSpan?.attributes?.["action_type"]).toBe("customer_reply");
    expect(actionSpan?.attributes?.["visibility"]).toBe("external");
    expect(actionSpan?.attributes?.["reversible"]).toBe(false);
  });

  it("emits tool span with action_type for update_status", async () => {
    const agent = makeAgent({ tools: ["update_status", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "update_status", args: { status: "resolved", incident_id: "INC-001" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "resolved", confidence: 0.7 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const actionSpan = result.spans.find((s) => s.name === "update_status");
    expect(actionSpan?.attributes?.["action_type"]).toBe("status_update");
    expect(actionSpan?.attributes?.["visibility"]).toBe("internal");
    expect(actionSpan?.attributes?.["reversible"]).toBe(true);
    expect(actionSpan?.attributes?.["target"]).toBe("INC-001");
  });

  it("emits tool span with action_type for post_to_channel", async () => {
    const agent = makeAgent({ tools: ["post_to_channel", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "post_to_channel", args: { channel: "#hiring-eng", message: "summary" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "resolved", confidence: 0.9 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const span = result.spans.find((s) => s.name === "post_to_channel");
    expect(span?.attributes?.["action_type"]).toBe("channel_post");
    expect(span?.attributes?.["visibility"]).toBe("internal");
    expect(span?.attributes?.["target"]).toBe("#hiring-eng");
  });

  it("emits tool span with action_type for flag_for_review", async () => {
    const agent = makeAgent({ tools: ["flag_for_review", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [{ name: "flag_for_review", args: { invoice_id: "INV-2026-0442", reason: "Dup" } }],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "needs_review", confidence: 0.93 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    const span = result.spans.find((s) => s.name === "flag_for_review");
    expect(span?.attributes?.["action_type"]).toBe("escalation");
    expect(span?.attributes?.["target"]).toBe("INV-2026-0442");
  });
});

// ─── No submit_result span emitted ───────────────────────────────────────────

describe("runActor - submit_result not in spans", () => {
  it("does NOT emit a tool_fact span for submit_result", async () => {
    const agent = makeAgent({ tools: ["lookup_account", "submit_result"] });
    const generate = makeScriptedGenerate([
      { functionCalls: [{ name: "lookup_account", args: { account_name: "X" } }] },
      { functionCalls: [{ name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.8 } }] },
    ]);

    const result = await runActor({ agent, generate });
    const submitSpan = result.spans.find((s) => s.name === "submit_result");
    expect(submitSpan).toBeUndefined();
  });
});

// ─── Registry injection ───────────────────────────────────────────────────────

describe("runActor - registry injection", () => {
  it("uses provided registry instead of creating a new one", async () => {
    const agent = makeAgent({ tools: ["lookup_account", "submit_result"] });
    const registry = createToolRegistry(["lookup_account", "submit_result"]);

    const generate = makeScriptedGenerate([
      { functionCalls: [{ name: "lookup_account", args: { account_name: "test" } }] },
      { functionCalls: [{ name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.5 } }] },
    ]);

    const result = await runActor({ agent, generate, registry });
    expect(result.agent_id).toBe("test-agent");
    expect(result.spans.some((s) => s.name === "lookup_account")).toBe(true);
  });
});

// ─── Multiple tool calls in one step ─────────────────────────────────────────

describe("runActor - multiple tool calls per step", () => {
  it("handles multiple function calls in a single response", async () => {
    const agent = makeAgent({ tools: ["lookup_account", "policy_search", "submit_result"] });
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "lookup_account", args: { account_name: "Acme" } },
          { name: "policy_search", args: { query: "refund" } },
        ],
      },
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "Done.", status: "resolved", confidence: 0.86 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    expect(result.spans.some((s) => s.name === "lookup_account")).toBe(true);
    expect(result.spans.some((s) => s.name === "policy_search")).toBe(true);
  });
});

// ─── Status validation ────────────────────────────────────────────────────────

describe("runActor - status validation", () => {
  it.each(["resolved", "failed", "needs_review", "blocked"] as const)(
    "accepts valid status: %s",
    async (status) => {
      const agent = makeAgent();
      const generate = makeScriptedGenerate([
        {
          functionCalls: [
            { name: "submit_result", args: { final_output: "x", status, confidence: 0.5 } },
          ],
        },
      ]);

      const result = await runActor({ agent, generate });
      expect(result.agent_status).toBe(status);
    }
  );

  it("falls back to 'failed' for invalid status", async () => {
    const agent = makeAgent();
    const generate = makeScriptedGenerate([
      {
        functionCalls: [
          { name: "submit_result", args: { final_output: "x", status: "INVALID_STATUS", confidence: 0.5 } },
        ],
      },
    ]);

    const result = await runActor({ agent, generate });
    expect(result.agent_status).toBe("failed");
  });
});
