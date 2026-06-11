/**
 * Tests for detection_source on LensFindingDraft and AuditFinding contracts.
 */
import { describe, it, expect } from "vitest";
import { validateLensFindingDraft, validateAuditFinding } from "../audit-finding.js";
import { DETECTION_SOURCES } from "../enums.js";

const validDraft = {
  task_id: "task_123",
  agent_id: "support_agent",
  lens: "privacy-retention",
  failure_mode: "Unsafe Retention",
  severity: "high" as const,
  confidence: 0.9,
  evidence: ["Sensitive entity types retained in memory."],
  recommended_action: "Redact before storing.",
  human_review_required: true,
};

const validFinding = {
  finding_id: "finding_456",
  task_id: "task_123",
  agent_id: "support_agent",
  lens: "privacy-retention",
  failure_mode: "Unsafe Retention",
  severity: "high" as const,
  confidence: 0.9,
  evidence: ["Sensitive entity types retained in memory."],
  evidence_keywords: ["sensitive", "memory"],
  recommended_action: "Redact before storing.",
  human_review_required: true,
  converted_to_eval: false,
  created_at: "2026-05-28T12:00:00Z",
  updated_at: "2026-05-28T12:00:00Z",
};

describe("DETECTION_SOURCES", () => {
  it("contains exactly 'normalizer' and 'agent'", () => {
    expect([...DETECTION_SOURCES]).toEqual(["normalizer", "agent"]);
  });
});

describe("validateLensFindingDraft — detection_source", () => {
  it("accepts draft without detection_source (omitted is fine)", () => {
    const result = validateLensFindingDraft(validDraft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBeUndefined();
  });

  it("accepts detection_source: 'normalizer'", () => {
    const result = validateLensFindingDraft({ ...validDraft, detection_source: "normalizer" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBe("normalizer");
  });

  it("accepts detection_source: 'agent'", () => {
    const result = validateLensFindingDraft({ ...validDraft, detection_source: "agent" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBe("agent");
  });

  it("rejects invalid detection_source value", () => {
    const result = validateLensFindingDraft({ ...validDraft, detection_source: "unknown_source" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("detection_source"))).toBe(true);
    }
  });

  it("rejects numeric detection_source", () => {
    const result = validateLensFindingDraft({ ...validDraft, detection_source: 42 });
    expect(result.ok).toBe(false);
  });

  it("accepts detection_source: undefined (omitted key is fine)", () => {
    const { ...rest } = validDraft;
    const result = validateLensFindingDraft(rest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBeUndefined();
  });

  it("all valid detection_source values pass", () => {
    for (const source of DETECTION_SOURCES) {
      const result = validateLensFindingDraft({ ...validDraft, detection_source: source });
      expect(result.ok, `Expected ${source} to be valid`).toBe(true);
    }
  });
});

describe("validateAuditFinding — detection_source", () => {
  it("accepts finding without detection_source (omitted is fine)", () => {
    const result = validateAuditFinding(validFinding);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBeUndefined();
  });

  it("accepts detection_source: 'normalizer'", () => {
    const result = validateAuditFinding({ ...validFinding, detection_source: "normalizer" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBe("normalizer");
  });

  it("accepts detection_source: 'agent'", () => {
    const result = validateAuditFinding({ ...validFinding, detection_source: "agent" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBe("agent");
  });

  it("rejects invalid detection_source value", () => {
    const result = validateAuditFinding({ ...validFinding, detection_source: "hybrid" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("detection_source"))).toBe(true);
    }
  });

  it("rejects boolean detection_source", () => {
    const result = validateAuditFinding({ ...validFinding, detection_source: true });
    expect(result.ok).toBe(false);
  });

  it("all valid detection_source values pass", () => {
    for (const source of DETECTION_SOURCES) {
      const result = validateAuditFinding({ ...validFinding, detection_source: source });
      expect(result.ok, `Expected ${source} to be valid for AuditFinding`).toBe(true);
    }
  });

  it("detection_source is passed through correctly in enriched finding", () => {
    const result = validateAuditFinding({ ...validFinding, detection_source: "agent" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.detection_source).toBe("agent");
  });
});

describe("contracts/index.ts — DETECTION_SOURCES exported", () => {
  it("can import DETECTION_SOURCES from contracts/index", async () => {
    const mod = await import("../index.js");
    expect(mod.DETECTION_SOURCES).toBeDefined();
    expect([...mod.DETECTION_SOURCES]).toEqual(["normalizer", "agent"]);
  });

  it("can import DetectionSource type (compile-time check via runtime usage)", async () => {
    const mod = await import("../index.js");
    const source: (typeof mod.DETECTION_SOURCES)[number] = "normalizer";
    expect(source).toBe("normalizer");
  });
});
