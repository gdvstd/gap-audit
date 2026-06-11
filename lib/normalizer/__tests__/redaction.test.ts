import { describe, it, expect } from "vitest";
import { detectEntities, redact } from "../redaction.js";

describe("detectEntities", () => {
  it("returns empty array for empty string", () => {
    expect(detectEntities("")).toEqual([]);
  });

  it("returns empty array for plain text with no PII", () => {
    expect(detectEntities("Hello world, this is a normal sentence.")).toEqual([]);
  });

  it("detects email addresses", () => {
    const result = detectEntities("Contact us at user@example.com for help.");
    expect(result).toContain("email");
  });

  it("detects multiple emails and deduplicates entity type", () => {
    const result = detectEntities("Send to alice@test.org and bob@test.org.");
    expect(result.filter((t) => t === "email")).toHaveLength(1);
  });

  it("detects US phone numbers", () => {
    const result = detectEntities("Call me at +1 (800) 555-1234 anytime.");
    expect(result).toContain("phone_number");
  });

  it("detects phone numbers without country code", () => {
    const result = detectEntities("Phone: 800-555-1234");
    expect(result).toContain("phone_number");
  });

  it("detects government IDs (SSN shape)", () => {
    const result = detectEntities("SSN is 123-45-6789.");
    expect(result).toContain("government_id");
  });

  it("detects government IDs without dashes", () => {
    const result = detectEntities("ID: 123456789");
    expect(result).toContain("government_id");
  });

  it("detects payment card numbers", () => {
    const result = detectEntities("Card: 4111 1111 1111 1111");
    expect(result).toContain("payment_card");
  });

  it("detects payment card numbers without spaces", () => {
    const result = detectEntities("card number 4111111111111111");
    expect(result).toContain("payment_card");
  });

  it("detects IP addresses", () => {
    const result = detectEntities("Server IP is 192.168.1.100");
    expect(result).toContain("ip_address");
  });

  it("returns sorted and deduplicated entity types", () => {
    const result = detectEntities(
      "email: foo@bar.com phone: 800-555-1234 another@baz.com"
    );
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it("detects multiple entity types in one string", () => {
    const result = detectEntities(
      "Email: admin@corp.com, SSN: 123-45-6789, IP: 10.0.0.1"
    );
    expect(result).toContain("email");
    expect(result).toContain("government_id");
    expect(result).toContain("ip_address");
  });

  it("does not detect entity inside an existing placeholder", () => {
    const result = detectEntities("<email> and <phone_number>");
    expect(result).toEqual([]);
  });
});

describe("redact", () => {
  it("returns unchanged text and empty entity_types for text with no PII", () => {
    const result = redact("No PII here.");
    expect(result.redacted).toBe("No PII here.");
    expect(result.entity_types).toEqual([]);
  });

  it("replaces email with placeholder", () => {
    const result = redact("Email user@example.com please.");
    expect(result.redacted).toContain("<email>");
    expect(result.redacted).not.toContain("user@example.com");
    expect(result.entity_types).toContain("email");
  });

  it("replaces phone number with placeholder", () => {
    const result = redact("Call 800-555-1234 now.");
    expect(result.redacted).toContain("<phone_number>");
    expect(result.redacted).not.toMatch(/800-555-1234/);
    expect(result.entity_types).toContain("phone_number");
  });

  it("replaces government ID with placeholder", () => {
    const result = redact("SSN: 123-45-6789");
    expect(result.redacted).toContain("<government_id>");
    expect(result.entity_types).toContain("government_id");
  });

  it("replaces payment card with placeholder", () => {
    const result = redact("Card 4111111111111111 used.");
    expect(result.redacted).toContain("<payment_card>");
    expect(result.entity_types).toContain("payment_card");
  });

  it("replaces IP address with placeholder", () => {
    const result = redact("IP 192.168.0.1 logged.");
    expect(result.redacted).toContain("<ip_address>");
    expect(result.entity_types).toContain("ip_address");
  });

  it("handles multiple entity types in one string", () => {
    const input = "user@test.com called from 555-123-4567";
    const result = redact(input);
    expect(result.redacted).not.toContain("user@test.com");
    expect(result.redacted).not.toMatch(/555-123-4567/);
    expect(result.entity_types).toContain("email");
    expect(result.entity_types).toContain("phone_number");
  });

  it("is idempotent: running redact twice produces the same string", () => {
    const input = "Contact admin@example.com or 800-555-1234.";
    const first = redact(input);
    const second = redact(first.redacted);
    expect(second.redacted).toBe(first.redacted);
  });

  it("does not double-detect placeholders on re-run", () => {
    const input = "SSN: 123-45-6789";
    const first = redact(input);
    const second = redact(first.redacted);
    expect(second.entity_types).toEqual([]);
  });

  it("handles empty string", () => {
    const result = redact("");
    expect(result.redacted).toBe("");
    expect(result.entity_types).toEqual([]);
  });

  it("entity_types are sorted and deduplicated", () => {
    const result = redact("foo@bar.com baz@qux.com 192.168.1.1");
    const sorted = [...result.entity_types].sort();
    expect(result.entity_types).toEqual(sorted);
    const unique = new Set(result.entity_types);
    expect(unique.size).toBe(result.entity_types.length);
  });
});
