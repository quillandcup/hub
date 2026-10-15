import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FEELINGS,
  FEELING_DISPLAY_GROUPS,
  FEELING_GROUP,
  FEELING_KEYS,
  checkinAnswered,
  checkoutAnswered,
  NEED_KEYS,
  isEmptyCheckin,
  parseCheckinPrefill,
  prickleHref,
  toggleFeeling,
  validateCheckin,
  type CheckinInput,
} from "@/lib/prickle-checkins";

const VALID: CheckinInput = { feelingsBefore: ["stressed"], need: "company", sessionRating: 4, feelingsAfter: ["calm"] };

describe("feeling options", () => {
  it("derives each feeling's group, leaving the off-grid ones ungrouped", () => {
    expect(FEELING_GROUP.tired).toBe("running_low");
    expect(FEELING_GROUP.overwhelmed).toBe("wound_up");
    expect(FEELING_GROUP.lonely).toBeNull();
  });

  it("splits the display into one row per group, ungrouped feelings together last", () => {
    expect(FEELING_DISPLAY_GROUPS.map((g) => g.map((f) => f.key))).toEqual([
      ["motivated"],
      ["calm", "content"],
      ["tired", "meh"],
      ["stressed", "anxious", "overwhelmed", "frustrated"],
      ["stuck", "lonely"],
    ]);
    expect(FEELING_DISPLAY_GROUPS.flat()).toHaveLength(FEELINGS.length);
  });

  // The table's CHECKs repeat these key lists; a key added on one side only would either be
  // rejected by Postgres or never offered in the UI.
  it("matches the keys allowed by the prickle_checkins migration", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261005000000_trim_prickle_checkin_options.sql"),
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
    ["too many feelings", { ...VALID, feelingsAfter: ["calm", "content", "tired"] }],
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

describe("checkinAnswered / checkoutAnswered", () => {
  const empty: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

  it("needs both of a half's answers", () => {
    expect(checkinAnswered(null)).toBe(false);
    expect(checkinAnswered({ ...empty, feelingsBefore: ["tired"] })).toBe(false);
    expect(checkinAnswered({ ...empty, feelingsBefore: ["tired"], need: "company" })).toBe(true);
    expect(checkoutAnswered({ ...empty, sessionRating: 4 })).toBe(false);
    expect(checkoutAnswered({ ...empty, sessionRating: 4, feelingsAfter: ["calm"] })).toBe(true);
  });
});
