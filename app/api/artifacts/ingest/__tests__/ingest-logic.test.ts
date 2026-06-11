/**
 * Ingest logic tests.
 * Tests both the disabled and enabled paths using injected adapters.
 */
import { describe, it, expect } from "vitest";
import { runIngest } from "../logic.js";
import type { TraceSourceAdapter } from "@/lib/integrations/arize-adapter.js";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter.js";
import { createInMemoryAuditMemory } from "@/lib/audit-memory/in-memory.js";
import type { RawTraceArtifact } from "@/lib/normalizer/raw-trace.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDisabledTraceSource(): TraceSourceAdapter {
  return {
    name: "arize",
    enabled() {
      return false;
    },
    async listTraceArtifacts() {
      return [];
    },
  };
}

function makeEnabledTraceSource(rawArtifacts: RawTraceArtifact[]): TraceSourceAdapter {
  return {
    name: "arize",
    enabled() {
      return true;
    },
    async listTraceArtifacts() {
      return rawArtifacts;
    },
  };
}

function makeRawArtifact(trace_id: string, agent_id = "agent-1"): RawTraceArtifact {
  return {
    trace_id,
    agent_id,
    started_at: "2026-05-01T10:00:00Z",
    user_input: "test input",
    final_output: "test output",
    declared_goal: "test goal",
    agent_status: "resolved",
    spans: [],
    source: { system: "arize", external_id: trace_id },
  };
}

// ── Disabled path ──────────────────────────────────────────────────────────

describe("runIngest — disabled path", () => {
  it("returns ingested_count 0 when trace source is disabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeDisabledTraceSource();
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.ingested_count).toBe(0);
  });

  it("returns empty artifact_ids when trace source is disabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeDisabledTraceSource();
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.artifact_ids).toEqual([]);
  });

  it("returns a run_id when disabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeDisabledTraceSource();
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(typeof result.run_id).toBe("string");
    expect(result.run_id.length).toBeGreaterThan(0);
  });

  it("includes a note when disabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeDisabledTraceSource();
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.note).toBeTruthy();
  });

  it("does not save any artifacts when disabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeDisabledTraceSource();
    await runIngest({ traceSource, memory, input: {} });
    const artifacts = await memory.listArtifacts();
    expect(artifacts).toHaveLength(0);
  });
});

// ── Enabled path ───────────────────────────────────────────────────────────

describe("runIngest — enabled path", () => {
  it("returns ingested_count equal to normalizable raw artifacts", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const raw = [makeRawArtifact("trace-1"), makeRawArtifact("trace-2")];
    const traceSource = makeEnabledTraceSource(raw);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.ingested_count).toBe(2);
  });

  it("returns artifact_ids with length matching ingested_count", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const raw = [makeRawArtifact("trace-1"), makeRawArtifact("trace-2")];
    const traceSource = makeEnabledTraceSource(raw);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.artifact_ids).toHaveLength(result.ingested_count);
  });

  it("artifact_ids match trace_ids from raw artifacts", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const raw = [makeRawArtifact("trace-unique-1"), makeRawArtifact("trace-unique-2")];
    const traceSource = makeEnabledTraceSource(raw);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.artifact_ids).toContain("trace-unique-1");
    expect(result.artifact_ids).toContain("trace-unique-2");
  });

  it("saves normalized artifacts to memory", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const raw = [makeRawArtifact("trace-1")];
    const traceSource = makeEnabledTraceSource(raw);
    await runIngest({ traceSource, memory, input: {} });
    const stored = await memory.listArtifacts();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.task_id).toBe("trace-1");
  });

  it("returns a run_id string when enabled", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeEnabledTraceSource([makeRawArtifact("t-1")]);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(typeof result.run_id).toBe("string");
    expect(result.run_id.length).toBeGreaterThan(0);
  });

  it("skips normalization failures and only counts successes", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    // agent_confidence out of range forces normalization failure
    const badRaw: RawTraceArtifact = {
      ...makeRawArtifact("trace-bad"),
      agent_confidence: 999, // Invalid: must be [0, 1]
    };
    const goodRaw = makeRawArtifact("trace-good");
    const traceSource = makeEnabledTraceSource([badRaw, goodRaw]);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.ingested_count).toBe(1);
    expect(result.artifact_ids).toContain("trace-good");
    expect(result.artifact_ids).not.toContain("trace-bad");
  });

  it("passes agent_id filter to listTraceArtifacts", async () => {
    let capturedInput: { agent_id?: string; since?: string; limit?: number } = {};
    const traceSource: TraceSourceAdapter = {
      name: "arize",
      enabled() { return true; },
      async listTraceArtifacts(input) {
        capturedInput = input;
        return [];
      },
    };
    const memory = createInMemoryAuditMemory();
    await runIngest({ traceSource, memory, input: { agent_id: "agent-filter" } });
    expect(capturedInput.agent_id).toBe("agent-filter");
  });

  it("returns ingested_count 0 when trace source returns empty list", async () => {
    const memory: AuditMemoryAdapter = createInMemoryAuditMemory();
    const traceSource = makeEnabledTraceSource([]);
    const result = await runIngest({ traceSource, memory, input: {} });
    expect(result.ingested_count).toBe(0);
    expect(result.artifact_ids).toEqual([]);
  });
});
