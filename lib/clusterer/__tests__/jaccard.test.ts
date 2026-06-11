import { describe, it, expect } from "vitest";
import { jaccard } from "../jaccard.js";

describe("jaccard", () => {
  it("both empty arrays → 1.0", () => {
    expect(jaccard([], [])).toBe(1.0);
  });

  it("one empty → 0.0", () => {
    expect(jaccard(["a", "b"], [])).toBe(0.0);
    expect(jaccard([], ["a", "b"])).toBe(0.0);
  });

  it("identical arrays → 1.0", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "c"])).toBe(1.0);
  });

  it("no overlap → 0.0", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0.0);
  });

  it("partial overlap → correct ratio", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(2 / 4);
  });

  it("single element overlap out of 3 distinct → 1/3", () => {
    expect(jaccard(["a"], ["a", "b"])).toBeCloseTo(1 / 2);
  });

  it("order does not matter", () => {
    const r1 = jaccard(["a", "b"], ["b", "a"]);
    expect(r1).toBe(1.0);
  });

  it("handles duplicates in input gracefully (treats as sets)", () => {
    expect(jaccard(["a", "a", "b"], ["a", "b"])).toBe(1.0);
  });
});
