import { afterEach, describe, expect, it, vi } from "vitest";
import { createStageTimer } from "@/lib/chat/timing";

describe("createStageTimer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs each parallel query's own duration, each sequential stage, and the total", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let t = 0;
    const timer = createStageTimer(() => t);
    t = 10;
    timer.mark("auth");
    const slow = timer.time("slow", Promise.resolve("a").then((v) => ((t = 70), v)));
    await expect(slow).resolves.toBe("a");
    t = 100;
    timer.mark("parallel");
    timer.log("channel");
    expect(info).toHaveBeenCalledWith("[chat] page %s %dms (%s)", "channel", 100, "auth 10, slow 60, parallel 90");
  });

  it("records sizes next to the timings", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timer = createStageTimer(() => 0);
    timer.note("rows", 50);
    timer.log("channel");
    expect(info.mock.calls[0][3]).toBe("rows=50");
  });

  it("still records a query that fails, and rethrows", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timer = createStageTimer(() => 0);
    await expect(timer.time("boom", Promise.reject(new Error("x")))).rejects.toThrow("x");
    timer.log("group");
    expect(info.mock.calls[0][3]).toBe("boom 0");
  });
});
