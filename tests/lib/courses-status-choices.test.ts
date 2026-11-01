import { describe, expect, it } from "vitest";
import { STATUS_CHOICES, statusChoices, statusLabel } from "@/lib/courses/status-choices";

describe("statusLabel", () => {
  it("names each stored option, and shows an unknown or missing one as what it is", () => {
    expect(statusLabel("published")).toBe("Published");
    expect(statusLabel("locked")).toBe("Locked");
    expect(statusLabel("drip")).toBe("Drip");
    expect(statusLabel("weird")).toBe("weird");
    expect(statusLabel(null)).toBe("No setting");
  });
});

describe("statusChoices", () => {
  it("offers Draft, Publish, Schedule, Drip and Lock", () => {
    expect(STATUS_CHOICES.map((c) => c.action)).toEqual(["Draft", "Publish", "Schedule", "Drip", "Lock"]);
    expect(statusChoices().map((c) => c.action)).toEqual(["Draft", "Publish", "Schedule", "Drip", "Lock"]);
  });

  it("never blocks Publish, whatever is above: a published lesson can wait in a draft module until the module is switched on", () => {
    // There is nothing to pass it: what is above an item limits its state, not what it may be set to.
    expect(statusChoices().find((c) => c.value === "published")?.disabledReason).toBeUndefined();
    expect(statusChoices("draft").find((c) => c.value === "published")?.disabledReason).toBeUndefined();
    expect(statusChoices("published").find((c) => c.value === "published")?.disabledReason).toBeUndefined();
  });

  it("marks Schedule and Drip as not offered yet, since they need a date or a delay, unless that is what the item already has", () => {
    expect(statusChoices("draft").filter((c) => c.disabledReason).map((c) => c.value)).toEqual(["scheduled", "drip"]);
    expect(statusChoices("drip").filter((c) => c.disabledReason).map((c) => c.value)).toEqual(["scheduled"]);
    expect(statusChoices("scheduled").filter((c) => c.disabledReason).map((c) => c.value)).toEqual(["drip"]);
  });
});
