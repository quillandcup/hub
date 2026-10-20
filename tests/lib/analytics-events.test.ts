import { describe, it, expect } from "vitest";
import { EVENTS, isEventName, validateProperties } from "@/lib/analytics/events";
import { templateRoute } from "@/lib/analytics/route";
import { eventsAllowed } from "@/lib/analytics/consent";
import { parseWindowDays } from "@/lib/analytics/funnels";
import { FUNNELS } from "@/lib/analytics/funnels";

describe("tracking plan", () => {
  it("only knows declared events", () => {
    expect(isEventName("onair_join_clicked")).toBe(true);
    expect(isEventName("toString")).toBe(false);
    expect(isEventName("made_up")).toBe(false);
    expect(isEventName(42)).toBe(false);
  });

  it("keeps declared properties and drops undeclared ones", () => {
    const result = validateProperties("onair_join_clicked", { live: true, room_size: 3, email: "a@b.c" });
    expect(result).toEqual({ ok: true, properties: { live: true, room_size: 3 } });
  });

  it("rejects a missing required property", () => {
    expect(validateProperties("onair_join_clicked", { live: true })).toMatchObject({ ok: false });
  });

  it.each([
    ["onair_join_clicked", { live: "yes", room_size: 1 }],
    ["onair_join_clicked", { live: true, room_size: -1 }],
    ["onair_join_clicked", { live: true, room_size: 1.5 }],
    ["element_clicked", { element: "marquee", route: "/" }],
    ["page_viewed", { route: "x".repeat(121) }],
  ] as const)("rejects a wrongly typed %s %j", (name, props) => {
    expect(validateProperties(name, props)).toMatchObject({ ok: false });
  });

  it("allows optional properties to be missing", () => {
    expect(validateProperties("element_clicked", { element: "button", route: "/dashboard" })).toEqual({
      ok: true,
      properties: { element: "button", route: "/dashboard" },
    });
  });

  it("treats a non-object as no properties", () => {
    expect(validateProperties("page_viewed", "nope")).toMatchObject({ ok: false });
  });

  it("names events object_action in snake_case", () => {
    for (const name of Object.keys(EVENTS)) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });

  it("only funnels over declared events", () => {
    for (const funnel of FUNNELS) for (const step of funnel.steps) expect(isEventName(step.event)).toBe(true);
  });
});

describe("templateRoute", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/", "/"],
    ["/prickles/3f2a9c1e-1111-4222-8333-444455556666", "/prickles/[id]"],
    ["/members/42/notes", "/members/[id]/notes"],
    ["/projects/Ab3dEf9hJk", "/projects/[id]"],
    ["/my-prickles/all?commit=abc123#top", "/my-prickles/all"],
    ["/settings/notifications", "/settings/notifications"],
  ])("%s -> %s", (input, expected) => {
    expect(templateRoute(input)).toBe(expected);
  });

  it.each([null, undefined, 3, "", "dashboard", "//evil.example/x", "https://evil.example/x"])("rejects %j", (input) => {
    expect(templateRoute(input)).toBeNull();
  });

  it("caps the length", () => {
    expect(templateRoute("/" + "a".repeat(500))!.length).toBe(120);
  });
});

describe("eventsAllowed", () => {
  it("is on where consent isn't required", () => {
    expect(eventsAllowed(false, null)).toBe(true);
    expect(eventsAllowed(false, "denied")).toBe(true);
  });

  it("needs an explicit yes where consent is required", () => {
    expect(eventsAllowed(true, null)).toBe(false);
    expect(eventsAllowed(true, "denied")).toBe(false);
    expect(eventsAllowed(true, "granted")).toBe(true);
  });
});

describe("parseWindowDays", () => {
  it("accepts the offered windows and defaults otherwise", () => {
    expect(parseWindowDays("7")).toBe(7);
    expect(parseWindowDays(["90"])).toBe(90);
    expect(parseWindowDays("5")).toBe(30);
    expect(parseWindowDays(undefined)).toBe(30);
  });
});
