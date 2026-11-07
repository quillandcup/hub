import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CHECKIN_HALF_FIELDS,
  EMOTION_CORE,
  EMOTION_PATH,
  EMOTION_KEYS,
  EMOTION_SUGGESTIONS,
  EMOTION_WHEEL,
  LEGACY_FEELING_TO_EMOTION,
  offersCheckins,
  searchEmotions,
  frequentEmotions,
  CHECKIN_ANSWER_KEYS,
  CHECKIN_FIELDS,
  skipAwarePatch,
  toggleSkipPatch,
  EMPTY_CHECKIN,
  ENERGY,
  INTENTION_MET,
  NEED_KEYS,
  PLEASANTNESS,
  checkinAnswered,
  checkinFromRow,
  checkinHref,
  checkinToRow,
  checkoutAnswered,
  corePairs,
  emotionParentsLabel,
  halfOf,
  isEmptyCheckin,
  parseCheckinPrefill,
  prickleHref,
  validateCheckin,
  withHalf,
  type CheckinInput,
} from "@/lib/prickle-checkins";

const VALID: CheckinInput = {
  skipped: [],
  pleasantBefore: 2,
  energyBefore: 1,
  emotionBefore: "lonely",
  need: "company",
  intentionMet: 4,
  pleasantAfter: 4,
  energyAfter: 3,
  emotionAfter: "hopeful",
};

describe("scales", () => {
  it.each([
    ["pleasantness", PLEASANTNESS],
    ["energy", ENERGY],
    ["intention met", INTENTION_MET],
  ])("%s labels every point 1-5, in order", (_name, points) => {
    expect(points.map((p) => p.value)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(points.map((p) => p.label)).size).toBe(5);
  });
});

describe("the Feeling Wheel", () => {
  it("has six cores in wheel order, three pleasant and three unpleasant, each with six middle and six outer feelings", () => {
    expect(EMOTION_WHEEL.map((c) => c.key)).toEqual(["mad", "scared", "joyful", "powerful", "peaceful", "sad"]);
    for (const core of EMOTION_WHEEL) {
      expect(core.middle).toHaveLength(6);
      expect(core.outer).toHaveLength(6);
    }
  });

  it("gives every key exactly one place on the wheel, so answers roll up without overlap", () => {
    expect(EMOTION_KEYS).toHaveLength(6 + 36 + 36);
    expect(new Set(EMOTION_KEYS).size).toBe(EMOTION_KEYS.length);
    expect(EMOTION_CORE.lonely).toBe("sad");
    expect(EMOTION_CORE.furious).toBe("mad");
    expect(EMOTION_CORE.peaceful).toBe("peaceful");
    // The rings group feelings by core; an outer word isn't the child of a middle one.
    expect(EMOTION_PATH.furious).toEqual(["mad", "furious"]);
    expect(EMOTION_PATH.rage).toEqual(["mad", "rage"]);
    expect(EMOTION_PATH.mad).toEqual(["mad"]);
    expect(emotionParentsLabel("furious")).toBe("Mad");
    expect(emotionParentsLabel("mad")).toBe("");
  });

  it("pairs each middle-ring word with the outer-ring word beside it", () => {
    expect(corePairs(EMOTION_WHEEL[0])).toEqual([
      ["hurt", "jealous"],
      ["hostile", "selfish"],
      ["angry", "frustrated"],
      ["rage", "furious"],
      ["hateful", "irritated"],
      ["critical", "skeptical"],
    ]);
  });

  it("uses Vibrant in place of the original's Sexy", () => {
    expect(EMOTION_PATH.vibrant).toEqual(["joyful", "vibrant"]);
    expect(EMOTION_KEYS).not.toContain("sexy");
  });

  // The table's CHECKs repeat these key lists; a key added on one side only would either be
  // rejected by Postgres or never offered in the UI.
  it("matches the keys allowed by the prickle_checkins migration", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261220000000_checkin_mood_and_feeling_wheel.sql"),
      "utf8"
    );
    const lists = [...sql.matchAll(/emotion_(?:before|after) IN \(([^)]+)\)/g)].map((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1])
    );
    expect(lists).toHaveLength(2);
    for (const keys of lists) expect(keys).toEqual([...EMOTION_KEYS]);
  });

  it("leaves the intention keys as the earlier migration allows them", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261005000000_trim_prickle_checkin_options.sql"),
      "utf8"
    );
    const needs = sql.match(/need IN \(([^)]+)\)/);
    expect([...needs![1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1])).toEqual([...NEED_KEYS]);
  });
});

describe("searchEmotions", () => {
  it("finds wheel words, and every word under a core by the core's name", () => {
    expect(searchEmotions("frus")).toEqual([{ emotion: "frustrated" }]);
    expect(searchEmotions("peaceful").map((r) => r.emotion)).toContain("serene");
    expect(searchEmotions("  ")).toEqual([]);
  });

  it("suggests the closest wheel words for common words that aren't on the wheel, saying why", () => {
    expect(searchEmotions("stuck")).toEqual([
      { emotion: "frustrated", suggestedFor: "stuck" },
      { emotion: "discouraged", suggestedFor: "stuck" },
      { emotion: "helpless", suggestedFor: "stuck" },
    ]);
    expect(searchEmotions("Burned  Out").map((r) => r.emotion)).toEqual(["sleepy", "apathetic", "inadequate"]);
    // A partial word reaches the suggestion once it's three letters; a phrase containing it does too.
    expect(searchEmotions("stre").map((r) => r.suggestedFor)).toContain("stressed");
    expect(searchEmotions("feeling stuck today").map((r) => r.emotion)).toContain("frustrated");
  });

  it("puts wheel matches first and doesn't repeat a word a suggestion also reaches", () => {
    const results = searchEmotions("calm");
    expect(new Set(results.map((r) => r.emotion)).size).toBe(results.length);
    expect(results[0]).toEqual({ emotion: "serene", suggestedFor: "calm" });
  });

  it("only suggests words on the wheel", () => {
    for (const emotions of Object.values(EMOTION_SUGGESTIONS)) {
      for (const e of emotions) expect(EMOTION_KEYS).toContain(e);
    }
  });
});

describe("carrying over the first design's feelings", () => {
  it("maps each to the same wheel word, or its first suggestion", () => {
    expect(LEGACY_FEELING_TO_EMOTION).toEqual({
      motivated: "energetic",
      calm: "serene",
      content: "content",
      tired: "sleepy",
      meh: "apathetic",
      stressed: "anxious",
      anxious: "anxious",
      overwhelmed: "helpless",
      frustrated: "frustrated",
      stuck: "frustrated",
      lonely: "lonely",
    });
  });

  it("matches the mapping in the migration", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261220000000_checkin_mood_and_feeling_wheel.sql"),
      "utf8"
    );
    const pairs = Object.fromEntries([...sql.matchAll(/WHEN '([a-z]+)' THEN '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(LEGACY_FEELING_TO_EMOTION);
  });
});

describe("validateCheckin", () => {
  it("accepts a full check-in and an empty one", () => {
    expect(validateCheckin(VALID)).toBeNull();
    expect(validateCheckin(EMPTY_CHECKIN)).toBeNull();
  });

  it("accepts a core feeling on its own", () => {
    expect(validateCheckin({ ...VALID, emotionBefore: "sad" })).toBeNull();
  });

  it.each([
    ["scale below range", { ...VALID, pleasantBefore: 0 }],
    ["scale above range", { ...VALID, energyAfter: 6 }],
    ["fractional scale", { ...VALID, intentionMet: 2.5 }],
    ["scale as a string", { ...VALID, pleasantAfter: "4" }],
    ["feeling not on the wheel", { ...VALID, emotionBefore: "hangry" }],
    ["unknown intention", { ...VALID, need: "snacks" }],
    ["not an object", null],
  ])("rejects %s", (_label, input) => {
    expect(validateCheckin(input)).not.toBeNull();
  });
});

describe("isEmptyCheckin", () => {
  it("is true only when every answer is cleared", () => {
    expect(isEmptyCheckin(EMPTY_CHECKIN)).toBe(true);
    for (const field of CHECKIN_ANSWER_KEYS) {
      expect(isEmptyCheckin({ ...EMPTY_CHECKIN, [field]: VALID[field] })).toBe(false);
    }
    // A skip is something to keep too: a check-in of only skips is not empty.
    expect(isEmptyCheckin({ ...EMPTY_CHECKIN, skipped: ["energyBefore"] })).toBe(false);
  });
});

describe("halves", () => {
  it("splits every answer into exactly one half", () => {
    const all = [...CHECKIN_HALF_FIELDS.checkin, ...CHECKIN_HALF_FIELDS.checkout].sort();
    expect(all).toEqual([...CHECKIN_ANSWER_KEYS].sort());
  });

  it("replaces one half, leaving the other alone and clearing what wasn't given", () => {
    const next = withHalf(VALID, "checkout", { intentionMet: 2 });
    expect(next).toEqual({ ...VALID, intentionMet: 2, pleasantAfter: null, energyAfter: null, emotionAfter: null });
    expect(halfOf(next, "checkin")).toEqual(halfOf(VALID, "checkin"));
  });
});

describe("checkinAnswered / checkoutAnswered", () => {
  it("check-in needs mood and intention; the feeling is optional", () => {
    expect(checkinAnswered(null)).toBe(false);
    expect(checkinAnswered({ ...EMPTY_CHECKIN, pleasantBefore: 3, energyBefore: 3 })).toBe(false);
    expect(checkinAnswered({ ...EMPTY_CHECKIN, pleasantBefore: 3, need: "company" })).toBe(false);
    expect(checkinAnswered({ ...EMPTY_CHECKIN, pleasantBefore: 3, energyBefore: 3, need: "company" })).toBe(true);
  });

  it("check-out needs got-what-you-came-for and mood", () => {
    expect(checkoutAnswered({ ...EMPTY_CHECKIN, intentionMet: 4 })).toBe(false);
    expect(checkoutAnswered({ ...EMPTY_CHECKIN, pleasantAfter: 4, energyAfter: 3 })).toBe(false);
    expect(checkoutAnswered({ ...EMPTY_CHECKIN, intentionMet: 4, pleasantAfter: 4, energyAfter: 3 })).toBe(true);
  });
});

describe("rows", () => {
  it("round-trips through a prickle_checkins row", () => {
    expect(checkinToRow(VALID)).toEqual({
      pleasant_before: 2,
      energy_before: 1,
      emotion_before: "lonely",
      need: "company",
      intention_met: 4,
      pleasant_after: 4,
      energy_after: 3,
      emotion_after: "hopeful",
      skipped: [],
    });
    expect(checkinFromRow(checkinToRow(VALID))).toEqual(VALID);
  });
});

describe("prefill links", () => {
  const comingIn = { pleasantBefore: 2, energyBefore: 4, emotionBefore: "anxious", need: "deep_focus" } as const;

  it("round-trips the coming-in answers through the query string", () => {
    const href = prickleHref("p1", comingIn);
    expect(href).toBe("/prickles/p1?pleasant=2&energy=4&emotion=anxious&need=deep_focus");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCheckinPrefill(params)).toEqual({ ...EMPTY_CHECKIN, ...comingIn });
  });

  it("carries them on to the check-in modal link", () => {
    expect(checkinHref("p1", "checkin", { need: "company" })).toBe("/my-prickles/history?checkin=p1&need=company");
    expect(checkinHref("p1", "checkout")).toBe("/my-prickles/history?checkout=p1");
  });

  it("links plainly when there's nothing to carry", () => {
    expect(prickleHref("p1", {})).toBe("/prickles/p1");
    expect(parseCheckinPrefill({})).toBeNull();
  });

  it("drops invalid values", () => {
    expect(parseCheckinPrefill({ pleasant: "9", energy: "x", emotion: "hangry", need: "snacks" })).toBeNull();
    expect(parseCheckinPrefill({ pleasant: "3", energy: "2.5" })).toEqual({ ...EMPTY_CHECKIN, pleasantBefore: 3 });
  });
});

describe("offersCheckins", () => {
  const writing = { purpose: "writing" };

  it("offers check-ins for a writing prickle from the calendar, and for other non-Pop-Up sources", () => {
    expect(offersCheckins({ source: "calendar", type: writing })).toBe(true);
    expect(offersCheckins({ source: "hub", type: writing })).toBe(true);
  });

  it("does not offer them for a Pop-Up Prickle (source zoom), even though its type is for writing", () => {
    expect(offersCheckins({ source: "zoom", type: writing })).toBe(false);
  });

  it("does not offer them for a prickle that isn't for writing, or has no type", () => {
    expect(offersCheckins({ source: "calendar", type: { purpose: "social" } })).toBe(false);
    expect(offersCheckins({ source: "calendar", type: null })).toBe(false);
    expect(offersCheckins({ source: "calendar" })).toBe(false);
  });
});

describe("frequentEmotions", () => {
  const a = (emotionBefore: string | null, emotionAfter: string | null = null) => ({ emotionBefore, emotionAfter });

  it("lists the most named feelings first, counting before and after answers", () => {
    const answers = [a("content", "content"), a("sleepy", "content"), a("sleepy"), a("proud"), a(null, null)];
    expect(frequentEmotions(answers, 8)).toEqual(["content", "sleepy", "proud"]);
    expect(frequentEmotions(answers, 2)).toEqual(["content", "sleepy"]);
  });

  it("keeps the wheel's order between ties, skips words off the wheel and gives nothing for no answers", () => {
    expect(frequentEmotions([a("sad"), a("mad"), a("not-a-feeling")], 8)).toEqual(["mad", "sad"]);
    expect(frequentEmotions([], 3)).toEqual([]);
    expect(frequentEmotions([a("mad")], 0)).toEqual([]);
  });
});

describe("skipped questions", () => {
  it("a skipped question counts as dealt with, so a half of answers and skips is answered", () => {
    expect(checkinAnswered({ ...EMPTY_CHECKIN, pleasantBefore: 3, skipped: ["energyBefore", "need"] })).toBe(true);
    expect(checkinAnswered({ ...EMPTY_CHECKIN, pleasantBefore: 3, skipped: ["energyBefore"] })).toBe(false);
    expect(checkoutAnswered({ ...EMPTY_CHECKIN, intentionMet: 4, skipped: ["pleasantAfter", "energyAfter"] })).toBe(true);
    // The feeling is optional either way.
    expect(checkinAnswered({ ...EMPTY_CHECKIN, skipped: ["pleasantBefore", "energyBefore", "need"] })).toBe(true);
  });

  it("skipping clears the answer and answering lifts the skip", () => {
    const answered = { ...EMPTY_CHECKIN, energyBefore: 2 };
    const skipped = { ...answered, ...toggleSkipPatch(answered, "energyBefore") };
    expect(skipped).toMatchObject({ energyBefore: null, skipped: ["energyBefore"] });
    expect({ ...skipped, ...skipAwarePatch(skipped, { energyBefore: 4 }) }).toMatchObject({ energyBefore: 4, skipped: [] });
    expect({ ...skipped, ...toggleSkipPatch(skipped, "energyBefore") }).toMatchObject({ energyBefore: null, skipped: [] });
  });

  it("keeps the other half's skips when a half is replaced, and the half's own skips in halfOf", () => {
    const base = { ...VALID, skipped: ["energyBefore" as const, "energyAfter" as const] };
    const next = withHalf({ ...base, energyBefore: null, energyAfter: null }, "checkout", { intentionMet: 2, skipped: ["pleasantAfter"] });
    expect(next.skipped).toEqual(["energyBefore", "pleasantAfter"]);
    expect(halfOf(next, "checkin").skipped).toEqual(["energyBefore"]);
  });

  it("validates the skip list: known questions only, once each, never also answered", () => {
    expect(validateCheckin({ ...VALID, pleasantBefore: null, skipped: ["pleasantBefore"] })).toBeNull();
    expect(validateCheckin({ ...VALID, skipped: ["bogus"] })).toBe("Invalid skip");
    expect(validateCheckin({ ...VALID, skipped: "need" })).toBe("Invalid skip");
    expect(validateCheckin({ ...VALID, pleasantBefore: null, skipped: ["pleasantBefore", "pleasantBefore"] })).toBe("Invalid skip");
    expect(validateCheckin({ ...VALID, skipped: ["pleasantBefore"] })).toMatch(/both answered and skipped/);
  });

  it("is stored by column name, and a row's skips map back to the questions", () => {
    const c = { ...EMPTY_CHECKIN, skipped: ["need" as const, "energyAfter" as const] };
    expect(checkinToRow(c).skipped).toEqual(["need", "energy_after"]);
    expect(checkinFromRow(checkinToRow(c))).toEqual(c);
  });

  it("matches the questions the migration allows", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20270520000000_checkin_skipped_questions.sql"), "utf8");
    const allowed = [...sql.match(/ARRAY\[([^\]]+)\]/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(Object.values(CHECKIN_FIELDS).sort());
  });
});
