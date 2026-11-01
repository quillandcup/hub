import { describe, expect, it } from "vitest";
import { runPool } from "@/lib/chat/upload-pool";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runPool", () => {
  it("returns an empty result for no items without calling the worker", async () => {
    let calls = 0;
    const out = await runPool([], 3, async () => (calls++, { ok: true as const, value: 1 }));
    expect(out).toEqual({ ok: true, results: [] });
    expect(calls).toBe(0);
  });

  it("runs fewer items than the limit all at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await runPool([1, 2], 5, async (n) => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
      return { ok: true as const, value: n * 2 };
    });
    expect(peak).toBe(2);
    expect(out).toEqual({ ok: true, results: [2, 4] });
  });

  it("never exceeds the limit and keeps input order whatever the finish order", async () => {
    let running = 0;
    let peak = 0;
    const items = [5, 1, 4, 2, 3, 0, 6];
    const out = await runPool(items, 3, async (n) => {
      peak = Math.max(peak, ++running);
      for (let i = 0; i < n; i++) await tick();
      running--;
      return { ok: true as const, value: n };
    });
    expect(peak).toBe(3);
    expect(out).toEqual({ ok: true, results: items });
  });

  it("treats a limit below 1 as 1", async () => {
    let peak = 0;
    let running = 0;
    await runPool([1, 2, 3], 0, async () => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
      return { ok: true as const, value: 0 };
    });
    expect(peak).toBe(1);
  });

  it("stops at the first failure: aborts running workers, starts no more, reports the index", async () => {
    const started: number[] = [];
    const sawAbort: number[] = [];
    const out = await runPool([0, 1, 2, 3, 4], 2, async (n, _i, signal) => {
      started.push(n);
      if (n === 1) {
        await tick();
        return { ok: false as const, error: "boom" };
      }
      await new Promise<void>((r) => signal.addEventListener("abort", () => (sawAbort.push(n), r())));
      return { ok: false as const, error: "aborted" };
    });
    expect(out).toEqual({ ok: false, index: 1, error: "boom", aborted: false });
    expect(sawAbort).toEqual([0]);
    expect(started).toEqual([0, 1]);
  });

  it("stops when the caller's signal aborts, and not at all if already aborted", async () => {
    const controller = new AbortController();
    const pending = runPool([1, 2, 3], 2, (_n, _i, signal) => new Promise<{ ok: true; value: number }>((r) => signal.addEventListener("abort", () => r({ ok: true as const, value: 0 }))), controller.signal);
    await tick();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, aborted: true });

    let calls = 0;
    const done = await runPool([1], 1, async () => (calls++, { ok: true as const, value: 1 }), controller.signal);
    expect(done).toMatchObject({ ok: false, aborted: true });
    expect(calls).toBe(0);
  });
});
