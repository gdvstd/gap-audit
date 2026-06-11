import { describe, it, expect, afterEach } from "vitest";
import { generateClusterId, __test__setClusterIdFactory } from "../cluster-id.js";

describe("generateClusterId", () => {
  afterEach(() => {
    __test__setClusterIdFactory(null);
  });

  it("returns a non-empty string by default", () => {
    const id = generateClusterId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns different values on successive calls by default", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateClusterId()));
    expect(ids.size).toBe(10);
  });

  it("uses the injected factory when set", () => {
    let count = 0;
    __test__setClusterIdFactory(() => `test-id-${++count}`);
    expect(generateClusterId()).toBe("test-id-1");
    expect(generateClusterId()).toBe("test-id-2");
  });

  it("reverts to UUID factory after resetting to null", () => {
    __test__setClusterIdFactory(() => "fixed");
    expect(generateClusterId()).toBe("fixed");
    __test__setClusterIdFactory(null);
    const id = generateClusterId();
    expect(id).not.toBe("fixed");
    expect(id.length).toBeGreaterThan(0);
  });
});
