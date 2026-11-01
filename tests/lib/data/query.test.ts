import { describe, expect, it, vi } from "vitest";
import { byKeyThenId, compareText, inChunks, must, sortByKey, upsertInChunks } from "@/lib/data/query";

describe("must", () => {
  it("returns the data", () => {
    expect(must({ data: [1], error: null })).toEqual([1]);
  });
  it("throws the database message", () => {
    expect(() => must({ data: null, error: { message: "boom" } })).toThrow("boom");
  });
});

describe("inChunks", () => {
  it("runs nothing for no values", async () => {
    const run = vi.fn(async () => [1]);
    expect(await inChunks([], 2, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
  it("dedupes, chunks at the boundary and joins in chunk order", async () => {
    const run = vi.fn(async (part: string[]) => part.map((p) => p.toUpperCase()));
    expect(await inChunks(["a", "b", "a", "c", "d"], 2, run)).toEqual(["A", "B", "C", "D"]);
    expect(run.mock.calls.map((c) => c[0])).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("rejects when a chunk fails", async () => {
    await expect(inChunks(["a", "b"], 1, async (p) => { if (p[0] === "b") throw new Error("x"); return p; })).rejects.toThrow("x");
  });
});

describe("ordering", () => {
  it("compareText compares by code unit", () => {
    expect([compareText("a", "b"), compareText("b", "a"), compareText("a", "a"), compareText("B", "a")]).toEqual([-1, 1, 0, -1]);
  });
  it("sortByKey sorts a copy and keeps ties in input order", () => {
    const rows = [{ k: "b", n: 1 }, { k: "a", n: 2 }, { k: "b", n: 0 }];
    expect(sortByKey(rows, (r) => r.k).map((r) => r.n)).toEqual([2, 1, 0]);
    expect(rows[0].n).toBe(1);
  });
  it("byKeyThenId breaks ties by ascending id, even when descending", () => {
    const rows = [{ k: "a", id: "2" }, { k: "b", id: "1" }, { k: "a", id: "1" }];
    const ids = (desc: boolean) => [...rows].sort(byKeyThenId((r) => r.k, (r) => r.id, desc)).map((r) => r.k + r.id);
    expect(ids(false)).toEqual(["a1", "a2", "b1"]);
    expect(ids(true)).toEqual(["b1", "a1", "a2"]);
  });
});

describe("upsertInChunks", () => {
  const table = (fail?: number) => {
    const upsert = vi.fn(async (rows: number[]) => ({ error: rows.includes(fail ?? -1) ? { message: "db says no" } : null }));
    return { upsert };
  };
  it("sends nothing for no rows", async () => {
    const t = table();
    await upsertInChunks(t, [], "id");
    expect(t.upsert).not.toHaveBeenCalled();
  });
  it("chunks at the boundary and passes onConflict", async () => {
    const t = table();
    await upsertInChunks(t, [1, 2, 3, 4], "id", 2);
    expect(t.upsert.mock.calls).toEqual([[[1, 2], { onConflict: "id" }], [[3, 4], { onConflict: "id" }]]);
  });
  it("defaults to 500 rows a chunk", async () => {
    const t = table();
    await upsertInChunks(t, Array.from({ length: 501 }, (_, i) => i), "id");
    expect(t.upsert).toHaveBeenCalledTimes(2);
  });
  it("runs chunks concurrently in groups and throws the database message", async () => {
    const t = table(3);
    await expect(upsertInChunks(t, [1, 2, 3, 4, 5], "id", 1, 2)).rejects.toThrow("db says no");
    expect(t.upsert).toHaveBeenCalledTimes(4);
  });
  it("stops after a failed sequential chunk", async () => {
    const t = table(1);
    await expect(upsertInChunks(t, [1, 2], "id", 1)).rejects.toThrow("db says no");
    expect(t.upsert).toHaveBeenCalledTimes(1);
  });
});
