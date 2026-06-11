import { describe, it, expect } from "vitest";
import {
  AGENT_STATUSES,
  TOOL_STATUSES,
  VISIBILITY_VALUES,
  RETENTION_RISKS,
  VERIFICATION_STATUSES,
  SOURCE_ORIGINS,
  SEVERITY_LEVELS,
  TREND_VALUES,
  REVIEW_DECISIONS,
} from "../enums.js";

describe("AGENT_STATUSES", () => {
  it("contains expected values", () => {
    expect(AGENT_STATUSES).toContain("resolved");
    expect(AGENT_STATUSES).toContain("failed");
    expect(AGENT_STATUSES).toContain("blocked");
    expect(AGENT_STATUSES).toContain("needs_review");
    expect(AGENT_STATUSES).toContain("unknown");
    expect(AGENT_STATUSES).toHaveLength(5);
  });
});

describe("TOOL_STATUSES", () => {
  it("contains expected values", () => {
    expect(TOOL_STATUSES).toContain("success");
    expect(TOOL_STATUSES).toContain("failed");
    expect(TOOL_STATUSES).toContain("blocked");
    expect(TOOL_STATUSES).toContain("partial");
    expect(TOOL_STATUSES).toContain("unknown");
    expect(TOOL_STATUSES).toHaveLength(5);
  });
});

describe("VISIBILITY_VALUES", () => {
  it("contains expected values", () => {
    expect(VISIBILITY_VALUES).toContain("internal");
    expect(VISIBILITY_VALUES).toContain("external");
    expect(VISIBILITY_VALUES).toContain("private");
    expect(VISIBILITY_VALUES).toContain("public");
    expect(VISIBILITY_VALUES).toContain("unknown");
    expect(VISIBILITY_VALUES).toHaveLength(5);
  });
});

describe("RETENTION_RISKS", () => {
  it("contains expected values in severity order", () => {
    expect(RETENTION_RISKS).toEqual(["low", "medium", "high", "critical"]);
  });
});

describe("VERIFICATION_STATUSES", () => {
  it("contains expected values", () => {
    expect(VERIFICATION_STATUSES).toContain("passed");
    expect(VERIFICATION_STATUSES).toContain("failed");
    expect(VERIFICATION_STATUSES).toContain("missing");
    expect(VERIFICATION_STATUSES).toContain("unknown");
  });
});

describe("SOURCE_ORIGINS", () => {
  it("contains expected values", () => {
    expect(SOURCE_ORIGINS).toContain("arize");
    expect(SOURCE_ORIGINS).toContain("seed");
    expect(SOURCE_ORIGINS).toContain("other");
    expect(SOURCE_ORIGINS).toHaveLength(3);
  });
});

describe("SEVERITY_LEVELS", () => {
  it("contains expected values in order", () => {
    expect(SEVERITY_LEVELS).toEqual(["low", "medium", "high", "critical"]);
  });
});

describe("TREND_VALUES", () => {
  it("contains expected values", () => {
    expect(TREND_VALUES).toContain("new");
    expect(TREND_VALUES).toContain("stable");
    expect(TREND_VALUES).toContain("increasing");
    expect(TREND_VALUES).toContain("decreasing");
    expect(TREND_VALUES).toContain("unknown");
    expect(TREND_VALUES).toHaveLength(5);
  });
});

describe("REVIEW_DECISIONS", () => {
  it("contains confirmed and dismissed only", () => {
    expect(REVIEW_DECISIONS).toEqual(["confirmed", "dismissed"]);
  });
});
