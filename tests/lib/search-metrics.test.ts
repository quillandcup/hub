import { describe, expect, it, vi } from "vitest";

const distribution = vi.fn();
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: (...args: unknown[]) => distribution(...args) } }));

import { recordSearchTimings } from "@/lib/search/metrics";

describe("recordSearchTimings", () => {
  it("records setup, total and each kind under the given surface", () => {
    distribution.mockReset();
    recordSearchTimings("results_page", { setupMs: 5, totalMs: 120, kindsMs: { members: 40, chat: 100 } });

    const unit = "millisecond";
    expect(distribution).toHaveBeenCalledTimes(4);
    expect(distribution).toHaveBeenCalledWith("search.duration", 5, { unit, attributes: { surface: "results_page", stage: "setup" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 120, { unit, attributes: { surface: "results_page", stage: "total" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 40, { unit, attributes: { surface: "results_page", stage: "kind", kind: "members" } });
    expect(distribution).toHaveBeenCalledWith("search.duration", 100, { unit, attributes: { surface: "results_page", stage: "kind", kind: "chat" } });
  });
});
