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
  });

  it("allows everything at the top of the course and under published modules", () => {
    expect(statusChoices([]).every((c) => !c.disabledReason)).toBe(true);
    expect(statusChoices([{ title: "Module 1", publishingOption: "published" }, { title: "Week 1", publishingOption: "published" }]).every((c) => !c.disabledReason)).toBe(true);
  });

  it("won't publish under a draft module, and names the nearest draft to publish first", () => {
    const choices = statusChoices([
      { title: "Module 1", publishingOption: "draft" },
      { title: "Week 1", publishingOption: "draft" },
    ]);
    expect(choices.find((c) => c.value === "published")?.disabledReason).toBe("Publish “Week 1” first");
    expect(choices.filter((c) => c.disabledReason).map((c) => c.value)).toEqual(["published"]);
  });

  it("looks past a published submodule to a draft module above it", () => {
    const choices = statusChoices([
      { title: "Module 1", publishingOption: "draft" },
      { title: "Week 1", publishingOption: "published" },
    ]);
    expect(choices.find((c) => c.value === "published")?.disabledReason).toBe("Publish “Module 1” first");
  });

  it("allows a published week inside a locked module, which Kajabi does too", () => {
    expect(statusChoices([{ title: "Module 2", publishingOption: "locked" }]).find((c) => c.value === "published")?.disabledReason).toBeUndefined();
  });
});
