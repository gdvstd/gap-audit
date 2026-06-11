import { describe, it, expect } from "vitest";
import { extractEvidenceKeywords } from "../evidence-keywords.js";

describe("extractEvidenceKeywords", () => {
  it("returns empty array for empty input", () => {
    expect(extractEvidenceKeywords([])).toEqual([]);
  });

  it("returns empty array for single empty string", () => {
    expect(extractEvidenceKeywords([""])).toEqual([]);
  });

  it("returns empty array for whitespace-only strings", () => {
    expect(extractEvidenceKeywords(["   ", "\t\n"])).toEqual([]);
  });

  it("returns empty array when all tokens are stopwords", () => {
    expect(extractEvidenceKeywords(["the and or is was"])).toEqual([]);
  });

  it("drops tokens shorter than 3 characters", () => {
    expect(extractEvidenceKeywords(["ok no hi yes"])).toEqual([]);
  });

  it("lowercases tokens before processing", () => {
    const result = extractEvidenceKeywords(["Enterprise EXCEPTION Policy"]);
    expect(result).toContain("enterprise");
    expect(result).toContain("exception");
    expect(result).toContain("policy");
  });

  it("splits on non-alphanumeric characters", () => {
    const result = extractEvidenceKeywords(["tool:policy-lookup returned 'enterprise exception'"]);
    expect(result).toContain("tool");
    expect(result).toContain("policy");
    expect(result).toContain("lookup");
    expect(result).toContain("returned");
    expect(result).toContain("enterprise");
    expect(result).toContain("exception");
  });

  it("removes stopwords from the fixed list", () => {
    const stopwords = ["the", "and", "or", "is", "was", "that", "this", "with", "for",
      "on", "at", "by", "from", "as", "it", "be", "not", "but", "if", "no", "yes",
      "are", "has", "have", "had", "were", "will", "can", "did", "does"];
    const result = extractEvidenceKeywords([stopwords.join(" ")]);
    expect(result).toEqual([]);
  });

  it("removes individual stopwords mixed with real tokens", () => {
    const result = extractEvidenceKeywords(["the policy lookup found exception"]);
    expect(result).not.toContain("the");
    expect(result).toContain("policy");
    expect(result).toContain("lookup");
    expect(result).toContain("found");
    expect(result).toContain("exception");
  });

  it("deduplicates tokens preserving first-seen order", () => {
    const result = extractEvidenceKeywords(["policy lookup policy denial"]);
    const policyOccurrences = result.filter((t) => t === "policy");
    expect(policyOccurrences).toHaveLength(1);
    expect(result.indexOf("policy")).toBeLessThan(result.indexOf("lookup"));
    expect(result.indexOf("lookup")).toBeLessThan(result.indexOf("denial"));
  });

  it("concatenates multiple evidence strings with a single space", () => {
    const result = extractEvidenceKeywords(["enterprise exception", "policy lookup"]);
    expect(result).toContain("enterprise");
    expect(result).toContain("exception");
    expect(result).toContain("policy");
    expect(result).toContain("lookup");
  });

  it("deduplicates tokens across concatenated strings", () => {
    const result = extractEvidenceKeywords(["enterprise exception", "enterprise policy"]);
    const enterpriseCount = result.filter((t) => t === "enterprise").length;
    expect(enterpriseCount).toBe(1);
  });

  it("handles mixed punctuation correctly", () => {
    const result = extractEvidenceKeywords(["tool:'policy-lookup' returned 'enterprise_exception'"]);
    expect(result).toContain("tool");
    expect(result).toContain("policy");
    expect(result).toContain("lookup");
    expect(result).toContain("returned");
    expect(result).toContain("enterprise");
    expect(result).toContain("exception");
  });

  it("returns a fresh array each call", () => {
    const r1 = extractEvidenceKeywords(["policy lookup"]);
    const r2 = extractEvidenceKeywords(["policy lookup"]);
    expect(r1).not.toBe(r2);
  });

  it("handles numeric tokens correctly - drops tokens shorter than 3 chars, keeps >= 3", () => {
    const result = extractEvidenceKeywords(["error 99 found", "timeout 404 code"]);
    expect(result).not.toContain("99");
    expect(result).toContain("found");
    expect(result).toContain("timeout");
    expect(result).toContain("404");
    expect(result).toContain("code");
  });

  it("preserves first-seen order across many tokens", () => {
    const result = extractEvidenceKeywords(["zebra apple mango"]);
    expect(result).toEqual(["zebra", "apple", "mango"]);
  });

  it("handles 'a' and 'an' stopwords (length < 3 AND stopword)", () => {
    const result = extractEvidenceKeywords(["a an the policy"]);
    expect(result).toEqual(["policy"]);
  });
});
