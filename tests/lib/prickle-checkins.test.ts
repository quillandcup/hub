import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FEELINGS,
  FEELING_DISPLAY_GROUPS,
  FEELING_GROUP,
  FEELING_KEYS,
  CHECKIN_AFTER_MINUTES,
  asksHowItWent,
  NEED_KEYS,
  isEmptyCheckin,
  parseCheckinPrefill,
  prickleHref,
  toggleFeeling,
  validateCheckin,
  type CheckinInput,
} from "@/lib/prickle-checkins";

const VALID: CheckinInput = { feelingsBefore: ["stressed"], need: "gentle", sessionRating: 4, feelingsAfter: ["calm"] };

describe("feeling options", () => {
  it("derives each feeling's group, leaving the off-grid ones ungrouped", () => {
    expect(FEELING_GROUP.drained).toBe("running_low");
    expect(FEELING_GROUP.overwhelmed).toBe("wound_up");
    expect(FEELING_GROUP.lonely).toBeNull();
  });

  it("splits the display into one row per group, ungrouped feelings together last", () => {
    expect(FEELING_DISPLAY_GROUPS.map((g) => g.map((f) => f.key))).toEqual([
      ["motivated", "inspired", "determined"],
      ["calm", "content", "curious"],
      ["tired", "drained", "meh"],
      ["stressed", "anxious", "overwhelmed", "frustrated"],
      ["stuck", "scattered", "lonely"],
    ]);
    expect(FEELING_DISPLAY_GROUPS.flat()).toHaveLength(FEELINGS.length);
  });

  // The table's CHECKs repeat these key lists; a key added on one side only would either be
  // rejected by Postgres or never offered in the UI.
  it("matches the keys allowed by the prickle_checkins migration", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261003000000_create_prickle_checkins.sql"),
      "utf8"
    );
    const arrays = [...sql.matchAll(/ARRAY\[([^\]]+)\]::TEXT\[\]/g)].map((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1])
    );
    expect(arrays).toHaveLength(2);
    for (const keys of arrays) expect(keys).toEqual([...FEELING_KEYS]);

    const needs = sql.match(/need IN \(([^)]+)\)/);
    expect([...needs![1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1])).toEqual([...NEED_KEYS]);
  });
});

describe("toggleFeeling", () => {
  it("adds and removes a feeling", () => {
    expect(toggleFeeling([], "tired")).toEqual(["tired"]);
    expect(toggleFeeling(["tired", "meh"], "tired")).toEqual(["meh"]);
  });

  it("ignores a third pick", () => {
    expect(toggleFeeling(["tired", "meh"], "calm")).toEqual(["tired", "meh"]);
  });
});

describe("validateCheckin", () => {
  it("accepts a valid check-in and an empty one", () => {
    expect(validateCheckin(VALID)).toBeNull();
    expect(validateCheckin({ feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] })).toBeNull();
  });

  it.each([
    ["unknown feeling", { ...VALID, feelingsBefore: ["hangry"] }],
    ["too many feelings", { ...VALID, feelingsAfter: ["calm", "content", "curious"] }],
    ["duplicate feelings", { ...VALID, feelingsBefore: ["calm", "calm"] }],
    ["feelings not an array", { ...VALID, feelingsBefore: "calm" }],
    ["unknown need", { ...VALID, need: "snacks" }],
    ["rating out of range", { ...VALID, sessionRating: 6 }],
    ["fractional rating", { ...VALID, sessionRating: 2.5 }],
    ["not an object", null],
  ])("rejects %s", (_label, input) => {
    expect(validateCheckin(input)).not.toBeNull();
  });
});

describe("isEmptyCheckin", () => {
  it("is true only when every answer is cleared", () => {
    expect(isEmptyCheckin({ feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] })).toBe(true);
    expect(isEmptyCheckin({ feelingsBefore: [], need: null, sessionRating: 3, feelingsAfter: [] })).toBe(false);
  });
});

describe("prickleHref / parseCheckinPrefill", () => {
  it("round-trips feelings and need through the query string", () => {
    const href = prickleHref("p1", ["stressed", "lonely"], "company");
    expect(href).toBe("/prickles/p1?feel=stressed%2Clonely&need=company");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCheckinPrefill(params)).toEqual({
      feelingsBefore: ["stressed", "lonely"],
      need: "company",
      sessionRating: null,
      feelingsAfter: [],
    });
  });

  it("links plainly when there's nothing to carry", () => {
    expect(prickleHref("p1", [], null)).toBe("/prickles/p1");
    expect(parseCheckinPrefill({})).toBeNull();
  });

  it("drops unknown keys and caps feelings at two", () => {
    expect(parseCheckinPrefill({ feel: "hangry,calm,tired,meh", need: "snacks" })).toEqual({
      feelingsBefore: ["calm", "tired"],
      need: null,
      sessionRating: null,
      feelingsAfter: [],
    });
    expect(parseCheckinPrefill({ feel: "hangry", need: "snacks" })).toBeNull();
  });
});

describe("asksHowItWent", () => {
  const start = "2026-10-01T15:00:00Z";
  const at = (minutes: number) => Date.parse(start) + minutes * 60_000;

  it("only asks about coming in before the start and early in the session", () => {
    expect(asksHowItWent(start, at(-30))).toBe(false);
    expect(asksHowItWent(start, at(CHECKIN_AFTER_MINUTES - 1))).toBe(false);
  });

  it("also asks how it went from CHECKIN_AFTER_MINUTES in, and afterwards", () => {
    expect(asksHowItWent(start, at(CHECKIN_AFTER_MINUTES))).toBe(true);
    expect(asksHowItWent(start, at(60 * 24))).toBe(true);
  });
});
