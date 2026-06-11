import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("GET /api/status", () => {
  const cleanup = (): void => {
    delete process.env["DEMO_SEED_MODE"];
    delete process.env["MONGODB_ENABLED"];
    delete process.env["ARIZE_ENABLED"];
    delete process.env["GEMINI_ENABLED"];
    delete process.env["GEMINI_MODEL"];
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["AGENT_BUILDER_ENABLED"];
  };

  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns demo_seed_mode true when DEMO_SEED_MODE is unset", async () => {
    const { GET } = await import("../status/route.js");
    const response = GET();
    const data = await response.json() as Record<string, unknown>;
    expect(data["demo_seed_mode"]).toBe(true);
  });

  it("returns demo_seed_mode false when DEMO_SEED_MODE=false", async () => {
    process.env["DEMO_SEED_MODE"] = "false";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.demo_seed_mode).toBe(false);
  });

  it("returns storage_mode memory by default", async () => {
    const { GET } = await import("../status/route.js");
    const response = GET();
    const data = await response.json() as Record<string, unknown>;
    expect(data["storage_mode"]).toBe("memory");
  });

  it("returns storage_mode mongodb when MONGODB_ENABLED=true", async () => {
    process.env["MONGODB_ENABLED"] = "true";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.storage_mode).toBe("mongodb");
  });

  it("returns all adapters disabled by default", async () => {
    const { GET } = await import("../status/route.js");
    const response = GET();
    const data = await response.json() as Record<string, unknown>;
    expect(data["arize"]).toBe("disabled");
    expect(data["mongodb"]).toBe("disabled");
    expect(data["gemini"]).toBe("disabled");
    expect(data["agent_builder"]).toBe("disabled");
  });

  it("returns missing_config for arize when enabled but no creds", async () => {
    process.env["ARIZE_ENABLED"] = "true";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.arize).toBe("missing_config");
  });

  it("returns enabled for arize when enabled with all creds", async () => {
    process.env["ARIZE_ENABLED"] = "true";
    process.env["ARIZE_PROJECT_ID"] = "proj-123";
    process.env["ARIZE_API_KEY"] = "key-abc";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.arize).toBe("enabled");
    delete process.env["ARIZE_PROJECT_ID"];
    delete process.env["ARIZE_API_KEY"];
  });

  it("returns missing_config for gemini when enabled but no model or creds", async () => {
    process.env["GEMINI_ENABLED"] = "true";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.gemini).toBe("missing_config");
  });

  it("returns missing_config for gemini when model is set but no creds", async () => {
    process.env["GEMINI_ENABLED"] = "true";
    process.env["GEMINI_MODEL"] = "gemini-2.5-flash";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.gemini).toBe("missing_config");
  });

  it("returns enabled for gemini in Vertex mode (project + model)", async () => {
    process.env["GEMINI_ENABLED"] = "true";
    process.env["GEMINI_MODEL"] = "gemini-2.5-flash";
    process.env["GOOGLE_CLOUD_PROJECT"] = "proj-123";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.gemini).toBe("enabled");
  });

  it("returns enabled for gemini in API-key mode (api key + model, no project)", async () => {
    process.env["GEMINI_ENABLED"] = "true";
    process.env["GEMINI_MODEL"] = "gemini-2.5-flash";
    process.env["GEMINI_API_KEY"] = "key-abc";
    const { getAdapterStatus } = await import("@/lib/runtime/adapter-status.js");
    const status = getAdapterStatus();
    expect(status.gemini).toBe("enabled");
  });

  it("includes app_version field", async () => {
    const { GET } = await import("../status/route.js");
    const response = GET();
    const data = await response.json() as Record<string, unknown>;
    expect(typeof data["app_version"]).toBe("string");
  });
});
