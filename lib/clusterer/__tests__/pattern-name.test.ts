import { describe, it, expect } from "vitest";
import { derivePatternName } from "../pattern-name.js";

describe("derivePatternName", () => {
  it("returns failure_mode_tag:task_type format", () => {
    expect(derivePatternName("evidence-output", "Evidence-Output Contradiction", "customer-inquiry"))
      .toBe("evidence-output-contradiction:customer-inquiry");
  });

  it("lowercases failure_mode and collapses non-alphanumeric to -", () => {
    expect(derivePatternName("false-success", "False Success", "incident-response"))
      .toBe("false-success:incident-response");
  });

  it("collapses multiple separators to single dash", () => {
    expect(derivePatternName("privacy-retention", "Unsafe   Retention!!", "unknown"))
      .toBe("unsafe-retention:unknown");
  });

  it("strips leading/trailing dashes from failure_mode_tag", () => {
    expect(derivePatternName("test", "  Leading Spaces  ", "unknown"))
      .toBe("leading-spaces:unknown");
  });

  it("uses task_type as-is in the second segment", () => {
    expect(derivePatternName("x", "mode", "incident-response"))
      .toBe("mode:incident-response");
  });

  it("handles task_type unknown", () => {
    expect(derivePatternName("lens", "My Mode", "unknown"))
      .toBe("my-mode:unknown");
  });
});
