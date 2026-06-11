/**
 * Tests for markAudited / listAuditedTaskIds — sweep tracking methods
 * added to the in-memory adapter.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryAuditMemory } from "../in-memory.js";
import type { AuditMemoryAdapter } from "../adapter.js";

describe("createInMemoryAuditMemory — sweep tracking", () => {
  let mem: AuditMemoryAdapter;

  beforeEach(() => {
    mem = createInMemoryAuditMemory();
  });

  describe("markAudited / listAuditedTaskIds", () => {
    it("returns empty array when nothing has been marked", async () => {
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toEqual([]);
    });

    it("marks a single task_id and lists it back", async () => {
      await mem.markAudited(["task-1"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toContain("task-1");
    });

    it("marks multiple task_ids in one call", async () => {
      await mem.markAudited(["task-1", "task-2", "task-3"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-2");
      expect(ids).toContain("task-3");
    });

    it("accumulates across multiple markAudited calls", async () => {
      await mem.markAudited(["task-1"]);
      await mem.markAudited(["task-2"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-2");
    });

    it("is idempotent: marking the same task_id twice does not duplicate it", async () => {
      await mem.markAudited(["task-1"]);
      await mem.markAudited(["task-1"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids.filter((id) => id === "task-1")).toHaveLength(1);
    });

    it("is idempotent: marking same ids in one call does not duplicate", async () => {
      await mem.markAudited(["task-1", "task-1"]);
      const ids = await mem.listAuditedTaskIds();
      expect(ids.filter((id) => id === "task-1")).toHaveLength(1);
    });

    it("handles empty array without throwing", async () => {
      await expect(mem.markAudited([])).resolves.toBeUndefined();
      const ids = await mem.listAuditedTaskIds();
      expect(ids).toEqual([]);
    });

    it("returns a fresh array each call (not internal store reference)", async () => {
      await mem.markAudited(["task-1"]);
      const l1 = await mem.listAuditedTaskIds();
      const l2 = await mem.listAuditedTaskIds();
      expect(l1).not.toBe(l2);
    });

    it("mutating the returned array does not affect internal store", async () => {
      await mem.markAudited(["task-1"]);
      const list = await mem.listAuditedTaskIds();
      list.push("injected");
      const list2 = await mem.listAuditedTaskIds();
      expect(list2).not.toContain("injected");
    });

    it("markAudited returns void (Promise<void>)", async () => {
      const result = await mem.markAudited(["task-1"]);
      expect(result).toBeUndefined();
    });

    it("different adapters have independent swept sets", async () => {
      const mem2 = createInMemoryAuditMemory();
      await mem.markAudited(["task-1"]);
      const ids = await mem2.listAuditedTaskIds();
      expect(ids).toEqual([]);
    });
  });
});
