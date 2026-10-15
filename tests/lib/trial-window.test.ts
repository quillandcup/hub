import { describe, expect, it } from "vitest";
import { pickTrialWindow, trialWindowFromSubscription } from "@/lib/trial-window";

const unix = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

describe("trialWindowFromSubscription", () => {
  it("reads trial_start and trial_end (unix seconds) from a Stripe subscription", () => {
    expect(trialWindowFromSubscription({ trial_start: unix("2026-03-01"), trial_end: unix("2026-03-08") })).toEqual({
      start: "2026-03-01",
      end: "2026-03-08",
    });
  });

  it.each([[null], [{}], [{ trial_start: null, trial_end: null }], [{ trial_start: 5, trial_end: 5 }]])(
    "returns null for a subscription without a trial (%j)",
    (data) => {
      expect(trialWindowFromSubscription(data)).toBeNull();
    }
  );
});

describe("pickTrialWindow", () => {
  const windows = [
    { start: "2025-06-01", end: "2025-06-08" },
    { start: "2026-03-02", end: "2026-04-01" },
  ];

  it("picks the trial that starts near the date entered, whatever its length", () => {
    expect(pickTrialWindow(windows, "2026-03-01")).toEqual({ start: "2026-03-02", end: "2026-04-01" });
    expect(pickTrialWindow(windows, "2025-06-01")).toEqual({ start: "2025-06-01", end: "2025-06-08" });
  });

  it("returns null when no trial starts within a week of it", () => {
    expect(pickTrialWindow(windows, "2026-01-01")).toBeNull();
    expect(pickTrialWindow([], "2026-03-01")).toBeNull();
  });
});
