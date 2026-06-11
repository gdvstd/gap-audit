import { describe, it, expect, beforeEach } from "vitest";

const globalAny = globalThis as unknown as { __silentOpsContainer?: unknown };

beforeEach(() => {
  globalAny.__silentOpsContainer = undefined;
});

describe("getContainer", () => {
  it("returns a container with memory and initialized promise", async () => {
    const { getContainer } = await import("../container.js");
    const c = getContainer();
    expect(c).toBeDefined();
    expect(typeof c.initialized).toBe("object");
    expect(typeof c.memory).toBe("object");
  });

  it("returns the same memory instance on repeated calls (singleton)", async () => {
    const { getContainer } = await import("../container.js");
    const c1 = getContainer();
    const c2 = getContainer();
    expect(c1.memory).toBe(c2.memory);
  });

  it("seeds findings after initialization", async () => {
    const { getContainer } = await import("../container.js");
    const c = getContainer();
    await c.initialized;
    const findings = await c.memory.listFindings();
    expect(findings.length).toBeGreaterThan(0);
  });

  it("seeds clusters after initialization", async () => {
    const { getContainer } = await import("../container.js");
    const c = getContainer();
    await c.initialized;
    const clusters = await c.memory.listClusters();
    expect(clusters.length).toBeGreaterThan(0);
  });
});

describe("getMemory", () => {
  it("returns initialized memory", async () => {
    const { getMemory } = await import("../container.js");
    const memory = await getMemory();
    const findings = await memory.listFindings();
    expect(findings.length).toBeGreaterThan(0);
  });
});
