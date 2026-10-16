import { describe, expect, it, vi } from "vitest";

const distribution = vi.fn();
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: (...args: unknown[]) => distribution(...args) } }));

import { recordSearchTimings } from "@/lib/search/metrics";

describe("recordSearchTimings", () => {
  it("records setup, total and each kind under the given surface", () => {
    distribution.mockReset();
    recordSearchTimings("results_page", { setupMs: 5, totalMs: 120, kindsMs: { members: 40, chat: 100 }, stagesMs: { chat_channels: 30, chat_query: 70 } });

    const unit = "millisecond";
    expect(distribution).toHaveBeenCalledTimes(6);
    expect(distribution).toHaveBeenCalledWith("search.duration", 5, { unit, attributes: { surface: "results_page", chat: "included", stage: "setup" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 120, { unit, attributes: { surface: "results_page", chat: "included", stage: "total" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 40, { unit, attributes: { surface: "results_page", chat: "included", stage: "kind", kind: "members" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 100, { unit, attributes: { surface: "results_page", chat: "included", stage: "kind", kind: "chat" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 30, { unit, attributes: { surface: "results_page", chat: "included", stage: "chat_channels" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 70, { unit, attributes: { surface: "results_page", chat: "included", stage: "chat_query" } });
  });

  it("labels searches without chat as excluded, including zero-duration searches", () => {
    distribution.mockReset();
    recordSearchTimings("palette", { setupMs: 0, totalMs: 0, kindsMs: { members: 0 } });
    expect(distribution).toHaveBeenCalledTimes(3);
    for (const [, , options] of distribution.mock.calls) {
      expect(options.attributes).toMatchObject({ surface: "palette", chat: "excluded" });
    }
    distribution.mockReset();
    recordSearchTimings("palette", { setupMs: 0, totalMs: 0, kindsMs: { chat: 0 } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 0, {
      unit: "millisecond", attributes: { surface: "palette", chat: "included", stage: "total" },
    });
  });
});
