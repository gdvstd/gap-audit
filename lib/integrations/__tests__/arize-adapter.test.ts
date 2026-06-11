/**
 * Arize trace-source adapter tests.
 * Uses an injected fetch double — no real network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createArizeTraceSource, mapArizeRecord } from "../arize-adapter.js";
import type { TraceSourceAdapter } from "../arize-adapter.js";
import type { RawTraceArtifact } from "../../normalizer/raw-trace.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function setArizeEnv(): void {
  process.env["ARIZE_ENABLED"] = "true";
  process.env["ARIZE_PROJECT_ID"] = "proj-test-123";
  process.env["ARIZE_API_KEY"] = "key-test-abc";
}

function clearArizeEnv(): void {
  delete process.env["ARIZE_ENABLED"];
  delete process.env["ARIZE_PROJECT_ID"];
  delete process.env["ARIZE_API_KEY"];
}

// Sample Arize API response matching the shape we map from.
// Keys match a simplified Arize trace/span payload.
function makeSampleArizeResponse(traceId = "trace-001", agentId = "agent-1"): unknown {
  return {
    data: [
      {
        trace_id: traceId,
        agent_id: agentId,
        started_at: "2026-05-01T10:00:00Z",
        ended_at: "2026-05-01T10:00:05Z",
        status: "ok",
        task_type: "customer-support",
        user_input: "I need a refund",
        final_output: "Your refund has been processed.",
        declared_goal: "Process refund request",
        agent_confidence: 0.9,
        spans: [
          {
            span_id: "span-001",
            kind: "tool",
            name: "lookup_policy",
            start_time: "2026-05-01T10:00:01Z",
            end_time: "2026-05-01T10:00:02Z",
            status: "ok",
            output: "Policy: refunds allowed within 30 days",
          },
        ],
      },
    ],
  };
}

// ── enabled() tests ────────────────────────────────────────────────────────

describe("createArizeTraceSource — enabled()", () => {
  afterEach(() => {
    clearArizeEnv();
  });

  it("returns false when ARIZE_ENABLED is unset", () => {
    clearArizeEnv();
    const adapter = createArizeTraceSource();
    expect(adapter.enabled()).toBe(false);
  });

  it("returns false when ARIZE_ENABLED=false", () => {
    process.env["ARIZE_ENABLED"] = "false";
    process.env["ARIZE_PROJECT_ID"] = "proj-123";
    process.env["ARIZE_API_KEY"] = "key-abc";
    const adapter = createArizeTraceSource();
    expect(adapter.enabled()).toBe(false);
  });

  it("returns false when ARIZE_ENABLED=true but ARIZE_PROJECT_ID is missing", () => {
    process.env["ARIZE_ENABLED"] = "true";
    process.env["ARIZE_API_KEY"] = "key-abc";
    delete process.env["ARIZE_PROJECT_ID"];
    const adapter = createArizeTraceSource();
    expect(adapter.enabled()).toBe(false);
  });

  it("returns false when ARIZE_ENABLED=true but ARIZE_API_KEY is missing", () => {
    process.env["ARIZE_ENABLED"] = "true";
    process.env["ARIZE_PROJECT_ID"] = "proj-123";
    delete process.env["ARIZE_API_KEY"];
    const adapter = createArizeTraceSource();
    expect(adapter.enabled()).toBe(false);
  });

  it("returns true when ARIZE_ENABLED=true and all credentials present", () => {
    setArizeEnv();
    const adapter = createArizeTraceSource();
    expect(adapter.enabled()).toBe(true);
  });

  it("has name 'arize'", () => {
    const adapter = createArizeTraceSource();
    expect(adapter.name).toBe("arize");
  });
});

// ── listTraceArtifacts — disabled path ────────────────────────────────────

describe("createArizeTraceSource — disabled path", () => {
  beforeEach(() => {
    clearArizeEnv();
  });

  afterEach(() => {
    clearArizeEnv();
  });

  it("returns [] when adapter is disabled (no env)", async () => {
    const adapter = createArizeTraceSource();
    const results = await adapter.listTraceArtifacts({});
    expect(results).toEqual([]);
  });

  it("returns [] when ARIZE_ENABLED=false even with credentials", async () => {
    process.env["ARIZE_ENABLED"] = "false";
    process.env["ARIZE_PROJECT_ID"] = "proj-123";
    process.env["ARIZE_API_KEY"] = "key-abc";
    const adapter = createArizeTraceSource();
    const results = await adapter.listTraceArtifacts({});
    expect(results).toEqual([]);
  });

  it("never throws even when disabled", async () => {
    const adapter = createArizeTraceSource();
    await expect(adapter.listTraceArtifacts({})).resolves.toEqual([]);
  });

  it("does not call fetch when disabled", async () => {
    let fetchCalled = false;
    const fakeFetch = async (): Promise<Response> => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await adapter.listTraceArtifacts({});
    expect(fetchCalled).toBe(false);
  });
});

// ── listTraceArtifacts — enabled path ─────────────────────────────────────

describe("createArizeTraceSource — enabled path with injected fetch", () => {
  beforeEach(() => {
    setArizeEnv();
  });

  afterEach(() => {
    clearArizeEnv();
  });

  it("returns mapped RawTraceArtifact[] from a sample Arize response", async () => {
    const sampleResponse = makeSampleArizeResponse("trace-001", "agent-1");
    const fakeFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify(sampleResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    const results = await adapter.listTraceArtifacts({});
    expect(results).toHaveLength(1);
    expect(results[0]?.trace_id).toBe("trace-001");
    expect(results[0]?.agent_id).toBe("agent-1");
  });

  it("returns [] when Arize API returns empty data array", async () => {
    const fakeFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    const results = await adapter.listTraceArtifacts({});
    expect(results).toEqual([]);
  });

  it("returns [] and does not throw when fetch fails", async () => {
    const fakeFetch = async (): Promise<Response> => {
      throw new Error("Network error");
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await expect(adapter.listTraceArtifacts({})).resolves.toEqual([]);
  });

  it("returns [] when Arize API returns non-200 status", async () => {
    const fakeFetch = async (): Promise<Response> => {
      return new Response('{"error":"unauthorized"}', { status: 401 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await expect(adapter.listTraceArtifacts({})).resolves.toEqual([]);
  });

  it("passes agent_id as query param when provided", async () => {
    let capturedUrl = "";
    const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await adapter.listTraceArtifacts({ agent_id: "agent-xyz" });
    expect(capturedUrl).toContain("agent_id=agent-xyz");
  });

  it("passes since as query param when provided", async () => {
    let capturedUrl = "";
    const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await adapter.listTraceArtifacts({ since: "2026-01-01T00:00:00Z" });
    expect(capturedUrl).toContain("since=");
  });

  it("passes limit as query param when provided", async () => {
    let capturedUrl = "";
    const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await adapter.listTraceArtifacts({ limit: 50 });
    expect(capturedUrl).toContain("limit=50");
  });

  it("includes ARIZE_API_KEY in Authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    await adapter.listTraceArtifacts({});
    const authHeader = capturedHeaders["Authorization"] ?? capturedHeaders["authorization"] ?? "";
    expect(authHeader).toContain("key-test-abc");
  });

  it("returns multiple artifacts when API returns multiple records", async () => {
    const sampleResponse = {
      data: [
        makeSampleArizeResponse("trace-001", "agent-1"),
        makeSampleArizeResponse("trace-002", "agent-2"),
      ].flatMap((r) => (r as { data: unknown[] }).data),
    };
    const fakeFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify(sampleResponse), { status: 200 });
    };
    const adapter = createArizeTraceSource({ httpGet: fakeFetch });
    const results = await adapter.listTraceArtifacts({});
    expect(results).toHaveLength(2);
  });
});

// ── mapArizeRecord pure mapping tests ────────────────────────────────────

describe("mapArizeRecord — pure mapping function", () => {
  it("maps trace_id to trace_id", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.trace_id).toBe("trace-abc");
  });

  it("maps agent_id to agent_id", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-xyz",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.agent_id).toBe("agent-xyz");
  });

  it("sets source system to arize", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.source?.system).toBe("arize");
  });

  it("sets external_id from trace_id in source_ref", () => {
    const record = {
      trace_id: "trace-ref-001",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.source?.external_id).toBe("trace-ref-001");
  });

  it("maps task_type when present", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      task_type: "customer-support",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.task_type).toBe("customer-support");
  });

  it("maps user_input to user_input", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      user_input: "Hello world",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.user_input).toBe("Hello world");
  });

  it("maps final_output to final_output", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      final_output: "Task done",
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.final_output).toBe("Task done");
  });

  it("maps agent_confidence when present", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      agent_confidence: 0.95,
      spans: [],
    };
    const result = mapArizeRecord(record);
    expect(result.agent_confidence).toBe(0.95);
  });

  it("maps span kind from span.kind field", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [
        {
          span_id: "s-1",
          kind: "tool",
          name: "do_thing",
          start_time: "2026-05-01T10:00:01Z",
          status: "ok",
        },
      ],
    };
    const result = mapArizeRecord(record);
    expect(result.spans[0]?.kind).toBe("tool");
    expect(result.spans[0]?.name).toBe("do_thing");
  });

  it("does not include system_prompt, chain_of_thought, or hidden context fields", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      system_prompt: "HIDDEN SYSTEM PROMPT",
      chain_of_thought: "HIDDEN REASONING",
      internal_state: "SECRET",
      spans: [],
    };
    const result = mapArizeRecord(record) as unknown as Record<string, unknown>;
    expect(Object.keys(result)).not.toContain("system_prompt");
    expect(Object.keys(result)).not.toContain("chain_of_thought");
    expect(Object.keys(result)).not.toContain("internal_state");
  });

  it("produces a valid RawTraceArtifact shape (has required fields)", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const result = mapArizeRecord(record);
    // Type-check: these must all be present
    const check: RawTraceArtifact = result;
    expect(check.trace_id).toBeDefined();
    expect(check.agent_id).toBeDefined();
    expect(Array.isArray(check.spans)).toBe(true);
  });

  it("returns a new object each call (no shared reference)", () => {
    const record = {
      trace_id: "trace-abc",
      agent_id: "agent-1",
      started_at: "2026-05-01T10:00:00Z",
      spans: [],
    };
    const r1 = mapArizeRecord(record);
    const r2 = mapArizeRecord(record);
    expect(r1).not.toBe(r2);
  });
});

// ── TraceSourceAdapter type test ──────────────────────────────────────────

describe("createArizeTraceSource — adapter type contract", () => {
  it("satisfies TraceSourceAdapter shape", () => {
    const adapter: TraceSourceAdapter = createArizeTraceSource();
    expect(typeof adapter.name).toBe("string");
    expect(typeof adapter.enabled).toBe("function");
    expect(typeof adapter.listTraceArtifacts).toBe("function");
  });
});
