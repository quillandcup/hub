import { describe, it, expect } from "vitest";
import { describeEvents, EVENTS } from "@/lib/analytics/events";
import {
  MAX_STEPS,
  type ExploreStep,
  exploreHref,
  formatStep,
  parseBreakdown,
  parseStep,
  parseSteps,
  stepFromFields,
} from "@/lib/analytics/explore";

describe("describeEvents", () => {
  it("lists every event with its properties as plain data", () => {
    const described = describeEvents();
    expect(described.map((e) => e.name)).toEqual(Object.keys(EVENTS));
    const join = described.find((e) => e.name === "onair_join_clicked")!;
    expect(join.properties).toEqual([
      { name: "live", kind: "bool", optional: false },
      { name: "room_size", kind: "int", optional: false },
    ]);
    const click = described.find((e) => e.name === "element_clicked")!;
    expect(click.properties.find((p) => p.name === "element")).toMatchObject({ kind: "enum", values: ["button", "link", "input", "other"] });
    expect(click.properties.find((p) => p.name === "text")).toMatchObject({ kind: "text", optional: true });
  });
});

describe("parseStep", () => {
  it("reads an event with typed filters", () => {
    expect(parseStep("onair_join_clicked:live=false,room_size=3")).toEqual({
      event: "onair_join_clicked",
      where: { live: false, room_size: 3 },
    });
  });

  it("reads a bare event", () => {
    expect(parseStep("page_viewed")).toEqual({ event: "page_viewed", where: {} });
  });

  it("decodes percent-encoded text values", () => {
    expect(parseStep("page_viewed:route=%2Fmy%2Cprickles%3Aall")).toEqual({
      event: "page_viewed",
      where: { route: "/my,prickles:all" },
    });
  });

  it.each(["made_up", "", "toString:live=true", "constructor"])("drops the unknown event %j", (raw) => {
    expect(parseStep(raw)).toBeNull();
  });

  it.each([
    ["an undeclared property", "onair_join_clicked:email=a%40b.c"],
    ["a property of the prototype", "onair_join_clicked:constructor=1"],
    ["a bool that isn't one", "onair_join_clicked:live=maybe"],
    ["a negative int", "onair_join_clicked:room_size=-1"],
    ["an enum value outside the plan", "element_clicked:element=marquee"],
    ["bad percent-encoding", "page_viewed:route=%E0%A4%A"],
    ["a filter without a value", "onair_join_clicked:live"],
  ])("ignores %s but keeps the step", (_label, raw) => {
    expect(parseStep(raw)?.where).toEqual({});
  });
});

describe("parseSteps", () => {
  it("keeps valid steps in order, from one param or several", () => {
    expect(parseSteps("page_viewed")).toHaveLength(1);
    expect(parseSteps(["onair_popover_opened", "nope", "onair_join_clicked"]).map((s) => s.event)).toEqual([
      "onair_popover_opened",
      "onair_join_clicked",
    ]);
    expect(parseSteps(undefined)).toEqual([]);
  });

  it("caps the number of steps", () => {
    expect(parseSteps(Array(MAX_STEPS + 3).fill("page_viewed"))).toHaveLength(MAX_STEPS);
  });
});

describe("parseBreakdown", () => {
  it("reads event.property when the plan declares it", () => {
    expect(parseBreakdown("onair_join_clicked.live")).toEqual({ event: "onair_join_clicked", property: "live", where: {} });
  });

  it("reads the breakdown's own filters, checked against the plan", () => {
    expect(parseBreakdown("element_clicked.text", "bogus=1,element=marquee")).toEqual({
      event: "element_clicked",
      property: "text",
      where: {},
    });
    expect(parseBreakdown("element_clicked.text", "element=button")).toEqual({
      event: "element_clicked",
      property: "text",
      where: { element: "button" },
    });
  });

  it.each([undefined, "", "onair_join_clicked", "onair_join_clicked.email", "made_up.live", "onair_join_clicked.constructor"])(
    "rejects %j",
    (raw) => {
      expect(parseBreakdown(raw)).toBeNull();
    }
  );
});

describe("stepFromFields", () => {
  it("coerces form strings and leaves out blank or invalid filters", () => {
    expect(
      stepFromFields("onair_join_clicked", [
        { property: "live", value: "true" },
        { property: "room_size", value: "" },
        { property: "bogus", value: "1" },
      ])
    ).toEqual({ event: "onair_join_clicked", where: { live: true } });
  });
});

describe("exploreHref / formatStep", () => {
  it("round-trips a question through the URL", () => {
    const steps: ExploreStep[] = [
      { event: "onair_popover_opened", where: { live: false } },
      { event: "page_viewed", where: { route: "/a,b:c" } },
    ];
    const href = exploreHref({ days: 7, steps, breakdown: { event: "onair_join_clicked", property: "live", where: { room_size: 2 } } });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/admin/analytics/explore");
    expect(url.searchParams.get("days")).toBe("7");
    expect(parseSteps(url.searchParams.getAll("step"))).toEqual(steps);
    expect(parseBreakdown(url.searchParams.get("breakdown")!, url.searchParams.get("bfilter")!)).toEqual({
      event: "onair_join_clicked",
      property: "live",
      where: { room_size: 2 },
    });
  });

  it("leaves out bfilter when the breakdown has no filters", () => {
    const href = exploreHref({ days: 7, steps: [], breakdown: { event: "page_viewed", property: "route", where: {} } });
    expect(new URL(href, "http://x").searchParams.has("bfilter")).toBe(false);
  });

  it("omits the breakdown when there is none", () => {
    expect(exploreHref({ days: 30, steps: [], breakdown: null })).toBe("/admin/analytics/explore?days=30");
    expect(formatStep({ event: "page_viewed", where: {} })).toBe("page_viewed");
  });
});
