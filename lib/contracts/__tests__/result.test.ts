import { describe, it, expect } from "vitest";
import {
  ok,
  fail,
  isString,
  isBoolean,
  isNumber,
  isStringArray,
  isObject,
  isArray,
  checkEnum,
  requireString,
  requireStringArray,
  requireBoolean,
  requireArray,
} from "../result.js";

describe("ok", () => {
  it("returns ok result with value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("works with object values", () => {
    const obj = { a: 1 };
    const r = ok(obj);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(obj);
  });
});

describe("fail", () => {
  it("returns fail result with errors", () => {
    const r = fail<number>(["error1", "error2"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["error1", "error2"]);
  });

  it("works with empty errors array", () => {
    const r = fail<string>([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(0);
  });
});

describe("isString", () => {
  it("returns true for strings", () => {
    expect(isString("hello")).toBe(true);
    expect(isString("")).toBe(true);
  });

  it("returns false for non-strings", () => {
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
    expect(isString([])).toBe(false);
  });
});

describe("isBoolean", () => {
  it("returns true for booleans", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  it("returns false for non-booleans", () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean("true")).toBe(false);
    expect(isBoolean(null)).toBe(false);
  });
});

describe("isNumber", () => {
  it("returns true for numbers", () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(1.5)).toBe(true);
    expect(isNumber(-10)).toBe(true);
  });

  it("returns false for non-numbers", () => {
    expect(isNumber("1")).toBe(false);
    expect(isNumber(null)).toBe(false);
    expect(isNumber(NaN)).toBe(false);
  });
});

describe("isStringArray", () => {
  it("returns true for string arrays", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["a", "b"])).toBe(true);
  });

  it("returns false for mixed arrays", () => {
    expect(isStringArray([1, "a"])).toBe(false);
    expect(isStringArray([null])).toBe(false);
  });

  it("returns false for non-arrays", () => {
    expect(isStringArray("abc")).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });
});

describe("isObject", () => {
  it("returns true for plain objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isObject(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isObject([])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isObject("x")).toBe(false);
    expect(isObject(1)).toBe(false);
  });
});

describe("isArray", () => {
  it("returns true for arrays", () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, 2])).toBe(true);
  });

  it("returns false for non-arrays", () => {
    expect(isArray({})).toBe(false);
    expect(isArray("[]")).toBe(false);
    expect(isArray(null)).toBe(false);
  });
});

describe("checkEnum", () => {
  const COLORS = ["red", "green", "blue"] as const;

  it("returns true and does not push error for valid value", () => {
    const errors: string[] = [];
    const result = checkEnum("red", COLORS, "color", errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("returns false and pushes error for invalid value", () => {
    const errors: string[] = [];
    const result = checkEnum("yellow", COLORS, "color", errors);
    expect(result).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("color");
  });

  it("rejects non-string values", () => {
    const errors: string[] = [];
    checkEnum(42, COLORS, "color", errors);
    expect(errors).toHaveLength(1);
  });

  it("rejects undefined", () => {
    const errors: string[] = [];
    checkEnum(undefined, COLORS, "color", errors);
    expect(errors).toHaveLength(1);
  });
});

describe("requireString", () => {
  it("passes for non-empty string field", () => {
    const errors: string[] = [];
    const result = requireString({ name: "Alice" }, "name", errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("fails for missing field", () => {
    const errors: string[] = [];
    const result = requireString({}, "name", errors);
    expect(result).toBe(false);
    expect(errors[0]).toContain("name");
  });

  it("fails for empty string", () => {
    const errors: string[] = [];
    requireString({ name: "" }, "name", errors);
    expect(errors).toHaveLength(1);
  });

  it("fails for non-string value", () => {
    const errors: string[] = [];
    requireString({ name: 123 }, "name", errors);
    expect(errors).toHaveLength(1);
  });
});

describe("requireStringArray", () => {
  it("passes for string array", () => {
    const errors: string[] = [];
    requireStringArray({ tags: ["a", "b"] }, "tags", errors);
    expect(errors).toHaveLength(0);
  });

  it("passes for empty array", () => {
    const errors: string[] = [];
    requireStringArray({ tags: [] }, "tags", errors);
    expect(errors).toHaveLength(0);
  });

  it("fails for missing field", () => {
    const errors: string[] = [];
    requireStringArray({}, "tags", errors);
    expect(errors[0]).toContain("tags");
  });

  it("fails for non-array", () => {
    const errors: string[] = [];
    requireStringArray({ tags: "x" }, "tags", errors);
    expect(errors).toHaveLength(1);
  });
});

describe("requireBoolean", () => {
  it("passes for boolean field", () => {
    const errors: string[] = [];
    requireBoolean({ active: true }, "active", errors);
    expect(errors).toHaveLength(0);
  });

  it("passes for false value", () => {
    const errors: string[] = [];
    requireBoolean({ active: false }, "active", errors);
    expect(errors).toHaveLength(0);
  });

  it("fails for missing field", () => {
    const errors: string[] = [];
    requireBoolean({}, "active", errors);
    expect(errors[0]).toContain("active");
  });

  it("fails for non-boolean", () => {
    const errors: string[] = [];
    requireBoolean({ active: 1 }, "active", errors);
    expect(errors).toHaveLength(1);
  });
});

describe("requireArray", () => {
  it("passes for array field", () => {
    const errors: string[] = [];
    requireArray({ items: [] }, "items", errors);
    expect(errors).toHaveLength(0);
  });

  it("fails for missing field", () => {
    const errors: string[] = [];
    requireArray({}, "items", errors);
    expect(errors[0]).toContain("items");
  });

  it("fails for non-array", () => {
    const errors: string[] = [];
    requireArray({ items: {} }, "items", errors);
    expect(errors).toHaveLength(1);
  });
});
