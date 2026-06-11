/**
 * Tests for the new SENSITIVITY_TIERS, tierFor, maxTier, and credential detectors
 * added to redaction.ts.
 */
import { describe, it, expect } from "vitest";
import {
  SENSITIVITY_TIERS,
  tierFor,
  maxTier,
  detectEntities,
  detectEntityMatches,
  redact,
} from "../redaction.js";

describe("SENSITIVITY_TIERS", () => {
  it("contains exactly routine, sensitive, critical", () => {
    expect([...SENSITIVITY_TIERS]).toEqual(["routine", "sensitive", "critical"]);
  });
});

describe("tierFor", () => {
  it("email → routine", () => {
    expect(tierFor("email")).toBe("routine");
  });

  it("phone_number → routine", () => {
    expect(tierFor("phone_number")).toBe("routine");
  });

  it("ip_address → routine", () => {
    expect(tierFor("ip_address")).toBe("routine");
  });

  it("government_id → sensitive", () => {
    expect(tierFor("government_id")).toBe("sensitive");
  });

  it("payment_card → sensitive", () => {
    expect(tierFor("payment_card")).toBe("sensitive");
  });

  it("api_key → critical", () => {
    expect(tierFor("api_key")).toBe("critical");
  });

  it("private_key → critical", () => {
    expect(tierFor("private_key")).toBe("critical");
  });

  it("password → critical", () => {
    expect(tierFor("password")).toBe("critical");
  });

  it("unknown entity type defaults to routine", () => {
    expect(tierFor("full_name")).toBe("routine");
    expect(tierFor("salary_expectation")).toBe("routine");
    expect(tierFor("unknown_type")).toBe("routine");
  });
});

describe("maxTier", () => {
  it("returns null for empty array", () => {
    expect(maxTier([])).toBeNull();
  });

  it("returns routine for only routine entities", () => {
    expect(maxTier(["email", "phone_number"])).toBe("routine");
  });

  it("returns sensitive when any sensitive entity is present", () => {
    expect(maxTier(["email", "government_id"])).toBe("sensitive");
  });

  it("returns sensitive for payment_card", () => {
    expect(maxTier(["phone_number", "payment_card"])).toBe("sensitive");
  });

  it("returns critical when any critical entity is present", () => {
    expect(maxTier(["email", "api_key"])).toBe("critical");
  });

  it("returns critical when private_key present alongside sensitive", () => {
    expect(maxTier(["government_id", "private_key"])).toBe("critical");
  });

  it("returns critical when password present", () => {
    expect(maxTier(["email", "password"])).toBe("critical");
  });

  it("returns the entity's own tier when only one entity", () => {
    expect(maxTier(["api_key"])).toBe("critical");
    expect(maxTier(["payment_card"])).toBe("sensitive");
    expect(maxTier(["email"])).toBe("routine");
  });

  it("critical > sensitive > routine ordering is correct", () => {
    expect(maxTier(["routine_type", "government_id", "api_key"])).toBe("critical");
  });
});

describe("credential detectors — private_key", () => {
  it("detects a PEM private key header", () => {
    const text = "Key: -----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----";
    const types = detectEntities(text);
    expect(types).toContain("private_key");
  });

  it("detects RSA private key header", () => {
    const text = "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----";
    expect(detectEntities(text)).toContain("private_key");
  });

  it("detects EC private key header", () => {
    const text = "-----BEGIN EC PRIVATE KEY-----";
    expect(detectEntities(text)).toContain("private_key");
  });

  it("detects OPENSSH private key header", () => {
    const text = "-----BEGIN OPENSSH PRIVATE KEY-----";
    expect(detectEntities(text)).toContain("private_key");
  });

  it("redacts private key header from text", () => {
    const text = "cert: -----BEGIN RSA PRIVATE KEY-----";
    const result = redact(text);
    expect(result.redacted).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(result.redacted).toContain("<private_key>");
    expect(result.entity_types).toContain("private_key");
  });

  it("detectEntityMatches returns private_key match", () => {
    const text = "-----BEGIN PRIVATE KEY-----";
    const matches = detectEntityMatches(text);
    expect(matches.some((m) => m.entity_type === "private_key")).toBe(true);
  });
});

describe("credential detectors — api_key", () => {
  it("detects OpenAI-style sk- API key", () => {
    const text = "key=sk-abcdefghij1234567890abcd";
    expect(detectEntities(text)).toContain("api_key");
  });

  it("detects AWS AKIA key", () => {
    const text = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    expect(detectEntities(text)).toContain("api_key");
  });

  it("detects GitHub personal access token (ghp_)", () => {
    const text = "token=ghp_" + "a".repeat(36);
    expect(detectEntities(text)).toContain("api_key");
  });

  it("detects Slack bot token (xoxb-)", () => {
    const text = "SLACK_TOKEN=xoxb-123456789-abcdefghij";
    expect(detectEntities(text)).toContain("api_key");
  });

  it("redacts API key from text", () => {
    const text = "key: sk-abcdefghij1234567890abcd";
    const result = redact(text);
    expect(result.redacted).not.toContain("sk-abcdefghij");
    expect(result.redacted).toContain("<api_key>");
    expect(result.entity_types).toContain("api_key");
  });

  it("detectEntityMatches returns api_key match for sk- key", () => {
    const text = "sk-abcdefghij1234567890abcd";
    const matches = detectEntityMatches(text);
    expect(matches.some((m) => m.entity_type === "api_key")).toBe(true);
  });
});

describe("credential detectors — password", () => {
  it("detects password=value pattern", () => {
    const text = "password=secretvalue";
    expect(detectEntities(text)).toContain("password");
  });

  it("detects password: value pattern", () => {
    const text = "password: my_s3cur3_pw";
    expect(detectEntities(text)).toContain("password");
  });

  it("detects passwd= pattern", () => {
    const text = "passwd=hunter2password";
    expect(detectEntities(text)).toContain("password");
  });

  it("detects secret= pattern", () => {
    const text = "secret=topsecretvalue";
    expect(detectEntities(text)).toContain("password");
  });

  it("detects token= pattern", () => {
    const text = "token=myauthtoken123";
    expect(detectEntities(text)).toContain("password");
  });

  it("does NOT flag password= with a very short value (< 6 chars)", () => {
    // "abc" is only 3 chars — below the 6-char threshold
    const text = "password=abc";
    expect(detectEntities(text)).not.toContain("password");
  });

  it("redacts password pattern from text", () => {
    const text = "config: password=mysuperpassword";
    const result = redact(text);
    expect(result.redacted).not.toContain("mysuperpassword");
    expect(result.redacted).toContain("<password>");
    expect(result.entity_types).toContain("password");
  });

  it("detectEntityMatches returns password match", () => {
    const text = "password=verysecretvalue";
    const matches = detectEntityMatches(text);
    expect(matches.some((m) => m.entity_type === "password")).toBe(true);
  });

  it("is case-insensitive for keyword matching", () => {
    expect(detectEntities("PASSWORD=mysupersecret")).toContain("password");
    expect(detectEntities("Secret=anothervalue")).toContain("password");
  });
});

describe("credential detectors — ordering (credential before phone_number)", () => {
  it("detects api_key in text that also contains digits (does not get eaten by phone_number)", () => {
    const text = "api_key=sk-abcdefghij1234567890 and phone 800-555-1234";
    const types = detectEntities(text);
    expect(types).toContain("api_key");
    expect(types).toContain("phone_number");
  });

  it("detects private_key header alongside an email", () => {
    const text = "Contact: admin@corp.com\nKey: -----BEGIN PRIVATE KEY-----";
    const types = detectEntities(text);
    expect(types).toContain("email");
    expect(types).toContain("private_key");
  });
});

describe("existing PII detectors still work after reorder", () => {
  it("email still detected", () => {
    expect(detectEntities("user@example.com")).toContain("email");
  });

  it("ip_address still detected", () => {
    expect(detectEntities("Server 192.168.1.1")).toContain("ip_address");
  });

  it("payment_card still detected", () => {
    expect(detectEntities("Card 4111111111111111")).toContain("payment_card");
  });

  it("government_id still detected", () => {
    expect(detectEntities("SSN: 123-45-6789")).toContain("government_id");
  });

  it("phone_number still detected", () => {
    expect(detectEntities("Call 800-555-1234")).toContain("phone_number");
  });

  it("text with no sensitive data → empty entity types", () => {
    expect(detectEntities("Hello world. This is a normal sentence.")).toEqual([]);
  });

  it("redact with no sensitive data → empty entity_types", () => {
    const result = redact("No sensitive data here.");
    expect(result.entity_types).toEqual([]);
  });
});
