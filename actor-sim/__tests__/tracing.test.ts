/**
 * Tests for actor-sim tracing.
 * Key integration test: toRawTraceArtifact -> normalizeRawTrace returns ok:true.
 */

import { describe, it, expect } from "vitest";
import { toRawTraceArtifact, createArizeExporter } from "../tracing.js";
import type { RunResult } from "../runner.js";
import { normalizeRawTrace } from "../../lib/normalizer/normalize.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    agent_id: "agent-support-01",
    task_type: "refund-request",
    user_input: "Acme Corp requests a refund after 18 days.",
    declared_goal: "Resolve Acme Corp refund request.",
    final_output: "Refund denied: outside 14-day window.",
    agent_status: "resolved",
    agent_confidence: 0.86,
    started_at: "2026-06-04T09:12:00Z",
    ended_at: "2026-06-04T09:13:10Z",
    spans: [
      {
        span_id: "s1",
        kind: "tool",
        name: "lookup_account",
        start_time: "2026-06-04T09:12:08Z",
        status: "ok",
        output: "plan: Enterprise; onboarding_status: incomplete; signup_days_ago: 18",
      },
      {
        span_id: "s2",
        kind: "tool",
        name: "policy_search",
        start_time: "2026-06-04T09:12:22Z",
        status: "ok",
        output: "Refund Policy v4. Standard 14-day window. Enterprise exception exists.",
      },
      {
        span_id: "s3",
        kind: "tool",
        name: "draft_reply",
        start_time: "2026-06-04T09:13:02Z",
        status: "ok",
        attributes: {
          action_type: "customer_reply",
          visibility: "external",
          reversible: false,
          target: "customer",
        },
        output: "Refund denied: outside 14-day window.",
      },
    ],
    ...overrides,
  };
}

function makeRunResultWithMemory(): RunResult {
  return makeRunResult({
    agent_id: "agent-recruiting-01",
    task_type: "candidate-screening",
    spans: [
      {
        span_id: "s1",
        kind: "tool",
        name: "parse_resume",
        start_time: "2026-06-04T10:02:05Z",
        status: "ok",
        output: "3 candidates parsed.",
      },
      {
        span_id: "s2",
        kind: "memory",
        name: "write_memory",
        start_time: "2026-06-04T10:03:20Z",
        status: "ok",
        attributes: { store: "candidate_db", retention_risk: "medium" },
        output: "Candidate A summary. Candidate B summary.",
      },
    ],
  });
}

function makeRunResultWithGuardrail(): RunResult {
  return makeRunResult({
    agent_id: "agent-support-01",
    task_type: "customer-inquiry",
    agent_status: "blocked",
    spans: [
      {
        span_id: "s1",
        kind: "tool",
        name: "attempt_identifier_reply",
        start_time: "2026-06-04T15:05:05Z",
        status: "blocked",
        attributes: {
          action_type: "customer_reply",
          visibility: "external",
          reversible: false,
          target: "customer-reply-channel",
        },
        output: "blocked by privacy-boundary",
      },
      {
        span_id: "s2",
        kind: "tool",
        name: "draft_reply",
        start_time: "2026-06-04T15:05:15Z",
        status: "ok",
        attributes: {
          action_type: "customer_reply",
          visibility: "external",
          reversible: false,
          target: "customer",
        },
        output: "Account status reply sent without identifier.",
      },
      {
        span_id: "s3",
        kind: "guardrail",
        name: "privacy-boundary",
        start_time: "2026-06-04T15:05:20Z",
        attributes: { reason: "customer-identifier-in-external-reply", count: 23, time_window: "P7D" },
        output: "blocked",
      },
    ],
  });
}

function makeRunResultWithVerification(): RunResult {
  return makeRunResult({
    agent_id: "agent-devops-01",
    task_type: "incident-response",
    agent_status: "needs_review",
    agent_confidence: 0.34,
    spans: [
      {
        span_id: "s1",
        kind: "tool",
        name: "restart_service",
        start_time: "2026-06-04T11:40:30Z",
        status: "ok",
        output: "service restarted; 2/2 pods healthy",
      },
      {
        span_id: "s2",
        kind: "tool",
        name: "query_metrics",
        start_time: "2026-06-04T11:42:00Z",
        status: "ok",
        attributes: { verification_type: "metric_recovery", verification_status: "failed" },
        output: "error_rate 31% vs threshold 2% — still elevated",
      },
    ],
  });
}

// ─── toRawTraceArtifact ───────────────────────────────────────────────────────

describe("toRawTraceArtifact", () => {
  it("maps agent_id and task_type", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.agent_id).toBe("agent-support-01");
    expect(artifact.task_type).toBe("refund-request");
  });

  it("generates trace_id from agent_id and started_at when not provided", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.trace_id).toContain("agent-support-01");
    expect(artifact.trace_id).toContain("2026-06-04");
  });

  it("uses provided traceId when given", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run, { traceId: "custom-trace-123" });
    expect(artifact.trace_id).toBe("custom-trace-123");
  });

  it("maps user_input, final_output, declared_goal", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.user_input).toBe("Acme Corp requests a refund after 18 days.");
    expect(artifact.final_output).toBe("Refund denied: outside 14-day window.");
    expect(artifact.declared_goal).toBe("Resolve Acme Corp refund request.");
  });

  it("maps agent_status and agent_confidence", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.agent_status).toBe("resolved");
    expect(artifact.agent_confidence).toBe(0.86);
  });

  it("maps spans directly", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.spans.length).toBe(3);
    expect(artifact.spans[0]?.kind).toBe("tool");
    expect(artifact.spans[0]?.name).toBe("lookup_account");
  });

  it("sets source to 'other' by default", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.source?.system).toBe("other");
  });

  it("sets source to 'arize' when specified", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run, { source: "arize" });
    expect(artifact.source?.system).toBe("arize");
  });

  it("does NOT include declared_goal when empty string", () => {
    const run = makeRunResult({ declared_goal: "" });
    const artifact = toRawTraceArtifact(run);
    expect(artifact.declared_goal).toBeUndefined();
  });

  it("includes started_at and ended_at", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    expect(artifact.started_at).toBe("2026-06-04T09:12:00Z");
    expect(artifact.ended_at).toBe("2026-06-04T09:13:10Z");
  });

  it("copies service metadata into raw trace artifact", () => {
    const run = makeRunResult({
      service_metadata: {
        customer_input: "Customer asks for refund because onboarding was incomplete.",
        company_task: "Determine refund eligibility.",
        customer_goal: "Receive the refund exception or escalation path.",
        final_response: "Refund denied using standard window.",
        conversation_signals: ["customer cites incomplete onboarding"],
        operational_signals: ["policy exception available"],
        business_signals: ["enterprise account"],
        support_context: { case_id: "case-refund-001", issue_category: "refund" },
      },
    });
    const artifact = toRawTraceArtifact(run);
    // Observed fields ARE recorded on the trace.
    expect(artifact.company_task).toBe("Determine refund eligibility.");
    expect(artifact.final_response).toBe("Refund denied using standard window.");
    expect(artifact.conversation_signals).toContain("customer cites incomplete onboarding");
    expect(artifact.support_context?.["case_id"]).toBe("case-refund-001");
    // customer_input / customer_goal are deliberately NOT recorded on the trace: a real
    // agent trace only carries what was observed (input, task, output, spans). The customer's
    // underlying goal is a JUDGMENT the audit agent derives (finding.expected_output), not
    // trace data — see toRawTraceArtifact. Keeping them off-trace preserves that boundary.
    expect(artifact.customer_input).toBeUndefined();
    expect(artifact.customer_goal).toBeUndefined();
  });
});

// ─── Integration: toRawTraceArtifact -> normalizeRawTrace ─────────────────────

describe("toRawTraceArtifact -> normalizeRawTrace integration", () => {
  it("normalizes CS refund agent trace to ok:true with tool_facts", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agent_id).toBe("agent-support-01");
    expect(result.value.task_type).toBe("refund-request");
    expect(result.value.tool_facts.length).toBeGreaterThanOrEqual(2);

    const lookupFact = result.value.tool_facts.find((f) => f.tool === "lookup_account");
    expect(lookupFact).toBeDefined();
    expect(lookupFact?.status).toBe("success");

    const policyFact = result.value.tool_facts.find((f) => f.tool === "policy_search");
    expect(policyFact).toBeDefined();
  });

  it("normalizes CS refund agent trace with actions_taken for draft_reply", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const action = result.value.actions_taken.find((a) => a.type === "customer_reply");
    expect(action).toBeDefined();
    expect(action?.visibility).toBe("external");
    expect(action?.reversible).toBe(false);
  });

  it("normalizes recruiting agent trace with memory_writes", () => {
    const run = makeRunResultWithMemory();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.memory_writes.length).toBeGreaterThanOrEqual(1);
    const mw = result.value.memory_writes[0];
    expect(mw?.store).toBe("candidate_db");
    expect(mw?.retention_risk).toBe("medium");
  });

  it("normalizes support guardrail trace with guardrail_events", () => {
    const run = makeRunResultWithGuardrail();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.guardrail_events.length).toBeGreaterThanOrEqual(1);
    const ge = result.value.guardrail_events[0];
    expect(ge?.type).toBe("privacy-boundary");
    expect(ge?.reason).toContain("customer-identifier");
    expect(ge?.count).toBe(23);
    expect(ge?.time_window).toBe("P7D");
  });

  it("normalizes DevOps agent trace with verification_artifacts", () => {
    const run = makeRunResultWithVerification();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.verification_artifacts).toBeDefined();
    const va = result.value.verification_artifacts?.[0];
    expect(va?.type).toBe("metric_recovery");
    expect(va?.status).toBe("failed");
  });

  it("normalizes agent_status correctly", () => {
    const run = makeRunResult({ agent_status: "needs_review" });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_status).toBe("needs_review");
  });

  it("normalizes agent_confidence", () => {
    const run = makeRunResult({ agent_confidence: 0.75 });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_confidence).toBe(0.75);
  });

  it("returns ok:false for invalid agent_confidence > 1", () => {
    const run = makeRunResult({ agent_confidence: 1.5 });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(false);
  });

  it("normalizes blocked agent status", () => {
    const run = makeRunResultWithGuardrail();
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_status).toBe("blocked");
  });

  it("normalizes source_refs", () => {
    const run = makeRunResult();
    const artifact = toRawTraceArtifact(run, { source: "arize" });
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source_refs).toBeDefined();
    expect(result.value.source_refs?.[0]?.source).toBe("arize");
  });

  it("normalizes with empty spans array", () => {
    const run = makeRunResult({ spans: [] });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_facts).toHaveLength(0);
    expect(result.value.memory_writes).toHaveLength(0);
    expect(result.value.guardrail_events).toHaveLength(0);
  });
});

// ─── Arize exporter no-op when creds unset ────────────────────────────────────

describe("createArizeExporter", () => {
  it("returns a no-op exporter when ARIZE_SPACE_ID and ARIZE_API_KEY are not set", async () => {
    // Ensure env vars are not set
    const origSpaceId = process.env["ARIZE_SPACE_ID"];
    const origApiKey = process.env["ARIZE_API_KEY"];
    delete process.env["ARIZE_SPACE_ID"];
    delete process.env["ARIZE_API_KEY"];

    try {
      const exporter = createArizeExporter();
      const run = makeRunResult();

      // Must not throw; no-op exporter returns null
      await expect(exporter.exportRun(run, "test-task")).resolves.toBeNull();
    } finally {
      if (origSpaceId !== undefined) process.env["ARIZE_SPACE_ID"] = origSpaceId;
      if (origApiKey !== undefined) process.env["ARIZE_API_KEY"] = origApiKey;
    }
  });

  it("no-op exporter can be called multiple times without error", async () => {
    delete process.env["ARIZE_SPACE_ID"];
    delete process.env["ARIZE_API_KEY"];

    const exporter = createArizeExporter();
    const run = makeRunResult();

    await exporter.exportRun(run, "test-task");
    await exporter.exportRun(run, "test-task");
    await exporter.exportRun(run, "test-task");
    // No error expected
    expect(true).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("toRawTraceArtifact - edge cases", () => {
  it("handles run with no spans", () => {
    const run = makeRunResult({ spans: [] });
    const artifact = toRawTraceArtifact(run);
    expect(artifact.spans).toHaveLength(0);
  });

  it("handles maximum confidence 1.0", () => {
    const run = makeRunResult({ agent_confidence: 1.0 });
    const artifact = toRawTraceArtifact(run);
    expect(artifact.agent_confidence).toBe(1.0);
    const result = normalizeRawTrace(artifact);
    expect(result.ok).toBe(true);
  });

  it("handles minimum confidence 0.0", () => {
    const run = makeRunResult({ agent_confidence: 0.0 });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agent_confidence).toBe(0.0);
  });

  it("handles spans with no attributes", () => {
    const run = makeRunResult({
      spans: [
        {
          span_id: "bare-1",
          kind: "tool",
          name: "bare_tool",
          start_time: "2026-06-04T09:12:00Z",
          status: "ok",
          output: "bare output",
        },
      ],
    });
    const artifact = toRawTraceArtifact(run);
    const result = normalizeRawTrace(artifact);
    expect(result.ok).toBe(true);
  });

  it("normalizes all 4 demo cases end-to-end", () => {
    // CS refund evidence-output contradiction
    const csRun = makeRunResult();
    expect(normalizeRawTrace(toRawTraceArtifact(csRun)).ok).toBe(true);

    // Trust-damaging retention
    const privacyRun = makeRunResultWithMemory();
    expect(normalizeRawTrace(toRawTraceArtifact(privacyRun)).ok).toBe(true);

    // Guardrail friction (support guardrail)
    const guardrailRun = makeRunResultWithGuardrail();
    expect(normalizeRawTrace(toRawTraceArtifact(guardrailRun)).ok).toBe(true);

    // DevOps verification failure
    const devopsRun = makeRunResultWithVerification();
    expect(normalizeRawTrace(toRawTraceArtifact(devopsRun)).ok).toBe(true);
  });
});
