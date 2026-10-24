import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Prickle check-ins: how a member feels coming into a prickle and leaving it, what they came for,
 * and whether they got it. One row per (member, prickle) in prickle_checkins (migration
 * 20261003000000, reshaped by 20261218000000), readable by the member and admins, never hosts or
 * other members. Clearing every answer soft-deletes the row (deleted_at), so every read filters
 * `deleted_at IS NULL`. The keys below are what's stored; labels can be reworded freely, but
 * adding, removing or renaming a key needs a migration (the table's CHECKs list the same keys --
 * tests/lib/prickle-checkins.test.ts fails if they drift). Why these questions: docs/CHECKINS.md.
 */

/** A labeled point on a 1-5 scale. Every point is labeled: that's what makes the answers comparable. */
export interface ScalePoint {
  value: number;
  label: string;
}

/**
 * Mood, measured on the two axes of the circumplex model of affect (Russell, 1980): how good or
 * bad you feel (pleasantness, or valence) and how much energy you have (arousal). The same
 * questions before and after a prickle, so the difference is the session's effect on mood.
 * Pleasantness is asked in everyday words, "very bad" to "very good", the anchors of the Feeling
 * Scale (Hardy & Rejeski, 1989), a single-item valence measure; see docs/CHECKINS.md.
 */
export const PLEASANTNESS: readonly ScalePoint[] = [
  { value: 1, label: "Very bad" },
  { value: 2, label: "Bad" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Very good" },
];

export const ENERGY: readonly ScalePoint[] = [
  { value: 1, label: "Very low" },
  { value: 2, label: "Low" },
  { value: 3, label: "Medium" },
  { value: 4, label: "High" },
  { value: 5, label: "Very high" },
];

/** Check-out: "Did you get what you came for?", against the intention chosen at check-in. */
export const INTENTION_MET: readonly ScalePoint[] = [
  { value: 1, label: "Not at all" },
  { value: 2, label: "A little" },
  { value: 3, label: "Somewhat" },
  { value: 4, label: "Mostly" },
  { value: 5, label: "Completely" },
];

export const PLEASANTNESS_QUESTION = "Overall, how do you feel?";
export const ENERGY_QUESTION = "How's your energy?";
export const INTENTION_MET_QUESTION = "Did you get what you came for?";
export const EMOTION_QUESTION = "Name the feeling";

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

/**
 * The Feeling Wheel, all three rings: six core feelings (three pleasant, three unpleasant), each
 * with two rings of related secondary feelings, six in the middle ring and six in the outer one,
 * in the wheel's own order (clockwise from Mad). In the original each middle-ring segment spans
 * two outer slots, one named word and one left blank for people's own words (p. 275), so each
 * middle word has one named outer partner (corePairs) and the picker shows them as pairs. A pick
 * is a core or one of its twelve feelings (two levels, not three).
 * Source: Gloria Willcox (1982), "The Feeling Wheel: A Tool for Expanding Awareness of Emotions
 * and Increasing Spontaneity and Intimacy," Transactional Analysis Journal 12(4), 274-276,
 * doi:10.1177/036215378201200411. Words checked against the wheel printed in the article (p. 276);
 * "Sexy" is replaced by "Vibrant", as some reproductions do. Chosen over
 * research-derived taxonomies for being familiar, balanced and even (docs/CHECKINS.md has the
 * comparison, sources, and the decision to attribute rather than seek permission).
 *
 * It's offered whole, never hand-picked, so every answer rolls up to exactly one core and no
 * part of the wheel is over- or under-represented. Optional: the mood scales above carry the
 * measurement; this is for naming the feeling. A member can stop at the core, or search for a
 * word and land on it directly (EmotionPicker, the Slack select's type-ahead).
 */
export const EMOTION_WHEEL = [
  {
    key: "mad",
    label: "Mad",
    middle: ["hurt", "hostile", "angry", "rage", "hateful", "critical"],
    outer: ["jealous", "selfish", "frustrated", "furious", "irritated", "skeptical"],
  },
  {
    key: "scared",
    label: "Scared",
    middle: ["rejected", "confused", "helpless", "submissive", "insecure", "anxious"],
    outer: ["bewildered", "discouraged", "insignificant", "weak", "foolish", "embarrassed"],
  },
  {
    key: "joyful",
    label: "Joyful",
    middle: ["excited", "vibrant", "energetic", "playful", "creative", "aware"],
    outer: ["daring", "fascinating", "stimulating", "amused", "extravagant", "delightful"],
  },
  {
    key: "powerful",
    label: "Powerful",
    middle: ["proud", "respected", "appreciated", "hopeful", "important", "faithful"],
    outer: ["cheerful", "satisfied", "valuable", "worthwhile", "intelligent", "confident"],
  },
  {
    key: "peaceful",
    label: "Peaceful",
    middle: ["nurturing", "trusting", "loving", "intimate", "thoughtful", "content"],
    outer: ["thankful", "sentimental", "serene", "responsive", "relaxed", "pensive"],
  },
  {
    key: "sad",
    label: "Sad",
    middle: ["sleepy", "bored", "lonely", "depressed", "ashamed", "guilty"],
    outer: ["apathetic", "inferior", "inadequate", "miserable", "stupid", "bashful"],
  },
] as const;

/** How the wheel is credited wherever it's shown. */
export const EMOTION_WHEEL_CREDIT = "Feeling Wheel by Gloria Willcox (1982)";

type WheelCore = (typeof EMOTION_WHEEL)[number];
export type EmotionCore = WheelCore["key"];
export type Emotion = EmotionCore | WheelCore["middle"][number] | WheelCore["outer"][number];

/**
 * A core's middle-ring feelings, each with the outer-ring feeling beside it on the wheel (the nth
 * middle word sits next to the nth outer word): [["rage", "furious"], ...].
 */
export function corePairs(core: (typeof EMOTION_WHEEL)[number]): readonly (readonly [Emotion, Emotion])[] {
  return core.middle.map((m, i) => [m, core.outer[i]] as const);
}

/** A core's twelve feelings, pair by pair: middle, its outer partner, the next middle, ... */
export function coreFeelings(core: (typeof EMOTION_WHEEL)[number]): readonly Emotion[] {
  return corePairs(core).flat();
}

/** Every storable emotion: the cores, then every middle-ring feeling, then every outer one, each in wheel order. */
export const EMOTION_KEYS: readonly Emotion[] = [
  ...EMOTION_WHEEL.map((c) => c.key),
  ...EMOTION_WHEEL.flatMap((c) => c.middle),
  ...EMOTION_WHEEL.flatMap((c) => c.outer),
];

/** Each emotion's path from the core: [core] for a core, [core, feeling] otherwise. */
export const EMOTION_PATH: Record<Emotion, readonly Emotion[]> = Object.fromEntries([
  ...EMOTION_WHEEL.map((c) => [c.key, [c.key]]),
  ...EMOTION_WHEEL.flatMap((c) => coreFeelings(c).map((f) => [f, [c.key, f]])),
]) as Record<Emotion, readonly Emotion[]>;

/** The core each emotion rolls up to (a core rolls up to itself). */
export const EMOTION_CORE: Record<Emotion, EmotionCore> = Object.fromEntries(
  EMOTION_KEYS.map((e) => [e, EMOTION_PATH[e][0]])
) as Record<Emotion, EmotionCore>;

export function emotionLabel(emotion: Emotion): string {
  return emotion.charAt(0).toUpperCase() + emotion.slice(1);
}

/** Where an emotion sits on the wheel: its core, e.g. "Mad" for furious; empty for a core. */
export function emotionParentsLabel(emotion: Emotion): string {
  return EMOTION_PATH[emotion].slice(0, -1).map(emotionLabel).join(" › ");
}

export const NEEDS = [
  { key: "momentum", label: "Momentum", hint: "Get words down" },
  { key: "deep_focus", label: "Deep focus", hint: "Heads-down, no distractions" },
  { key: "accountability", label: "Accountability", hint: "Just show up and do something" },
  { key: "company", label: "Company", hint: "Work alongside people, fill my cup" },
  { key: "unstuck", label: "Unstuck", hint: "Talk it through or brainstorm" },
] as const;

export type Need = (typeof NEEDS)[number]["key"];

/**
 * The prickle vibe a need points at, used to pre-select Find a Prickle's mood step (the
 * member can still change it). Accountability is about showing up, not the room, so no vibe.
 */
export const NEED_VIBE: Record<Need, "focused" | "balanced" | "chatty" | null> = {
  momentum: "focused",
  deep_focus: "focused",
  accountability: null,
  company: "chatty",
  unstuck: "chatty",
};

export const NEED_KEYS: readonly Need[] = NEEDS.map((n) => n.key);

/**
 * A prickle check-in has two halves, asked at different times, in Slack DMs
 * (lib/prickle-checkin-dms.ts) and on the site alike:
 * - Check-in, coming in: mood (pleasantBefore, energyBefore), optionally the feeling named on
 *   the wheel (emotionBefore), and their intention for the session (need).
 * - Check-out, afterwards: did they get what they came for (intentionMet), mood again
 *   (pleasantAfter, energyAfter) and optionally the feeling (emotionAfter).
 * Both are stored on the same prickle_checkins row.
 *
 * On the site, both halves live in the check-in / check-out modal opened from the Attendance
 * History rows (checkinHref), editable any time: the check-in always, the check-out (with the
 * progress question per project) once the prickle has started. The prickle page only links there.
 * The Log Progress modal asks only the check-out and links to the modal for the check-in. The Slack DMs keep their
 * own timing (check-in ~20 min before, check-out 5 min after the end or 10 min after leaving early).
 */
export interface CheckinInput {
  pleasantBefore: number | null;
  energyBefore: number | null;
  emotionBefore: Emotion | null;
  need: Need | null;
  intentionMet: number | null;
  pleasantAfter: number | null;
  energyAfter: number | null;
  emotionAfter: Emotion | null;
}

export const EMPTY_CHECKIN: CheckinInput = {
  pleasantBefore: null,
  energyBefore: null,
  emotionBefore: null,
  need: null,
  intentionMet: null,
  pleasantAfter: null,
  energyAfter: null,
  emotionAfter: null,
};

/** Which answers belong to each half, so a half can be saved without touching the other. */
export const CHECKIN_HALF_FIELDS = {
  checkin: ["pleasantBefore", "energyBefore", "emotionBefore", "need"],
  checkout: ["intentionMet", "pleasantAfter", "energyAfter", "emotionAfter"],
} as const satisfies Record<"checkin" | "checkout", readonly (keyof CheckinInput)[]>;

/** `base` with one half's answers replaced by `answers` (missing ones cleared). */
export function withHalf(base: CheckinInput, half: "checkin" | "checkout", answers: Partial<CheckinInput>): CheckinInput {
  const next = { ...base } as Record<keyof CheckinInput, unknown>;
  for (const field of CHECKIN_HALF_FIELDS[half]) next[field] = answers[field] ?? null;
  return next as unknown as CheckinInput;
}

/** One half's answers, e.g. to save just that half. */
export function halfOf(c: CheckinInput, half: "checkin" | "checkout"): Partial<CheckinInput> {
  return Object.fromEntries(CHECKIN_HALF_FIELDS[half].map((f) => [f, c[f]]));
}

export function isEmptyCheckin(c: CheckinInput): boolean {
  return (Object.keys(EMPTY_CHECKIN) as (keyof CheckinInput)[]).every((k) => c[k] === null);
}

const SCALE_FIELDS = ["pleasantBefore", "energyBefore", "intentionMet", "pleasantAfter", "energyAfter"] as const;

/** Validates untrusted input (server actions are public POST endpoints); returns an error message or null. */
export function validateCheckin(input: unknown): string | null {
  if (!input || typeof input !== "object") return "Invalid check-in";
  const c = input as Record<string, unknown>;
  for (const field of SCALE_FIELDS) {
    const v = c[field];
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= SCALE_MIN && v <= SCALE_MAX)) {
      return "Invalid rating";
    }
  }
  for (const field of ["emotionBefore", "emotionAfter"] as const) {
    if (c[field] !== null && !(EMOTION_KEYS as readonly unknown[]).includes(c[field])) return "Invalid feeling";
  }
  if (c.need !== null && !(NEED_KEYS as readonly unknown[]).includes(c.need)) return "Invalid intention";
  return null;
}

/**
 * Whether the check-in half is answered: mood and intention (naming the feeling is optional). A
 * partly answered check-in is still offered, to finish it (the Slack check-in DM is sent for one too).
 */
export function checkinAnswered(saved: CheckinInput | null): boolean {
  return !!saved && saved.pleasantBefore !== null && saved.energyBefore !== null && saved.need !== null;
}

/** Same for the check-out half: got what they came for, and mood. */
export function checkoutAnswered(saved: CheckinInput | null): boolean {
  return !!saved && saved.intentionMet !== null && saved.pleasantAfter !== null && saved.energyAfter !== null;
}

/** The prickle_checkins columns holding the answers, for selects. */
export const CHECKIN_COLUMNS =
  "pleasant_before, energy_before, emotion_before, need, intention_met, pleasant_after, energy_after, emotion_after";

export interface CheckinRow {
  pleasant_before: number | null;
  energy_before: number | null;
  emotion_before: string | null;
  need: string | null;
  intention_met: number | null;
  pleasant_after: number | null;
  energy_after: number | null;
  emotion_after: string | null;
}

/** A prickle_checkins row's answers (live rows only: callers filter `deleted_at IS NULL`). */
export function checkinFromRow(row: CheckinRow): CheckinInput {
  return {
    pleasantBefore: row.pleasant_before ?? null,
    energyBefore: row.energy_before ?? null,
    emotionBefore: (row.emotion_before ?? null) as Emotion | null,
    need: (row.need ?? null) as Need | null,
    intentionMet: row.intention_met ?? null,
    pleasantAfter: row.pleasant_after ?? null,
    energyAfter: row.energy_after ?? null,
    emotionAfter: (row.emotion_after ?? null) as Emotion | null,
  };
}

export function checkinToRow(c: CheckinInput): CheckinRow {
  return {
    pleasant_before: c.pleasantBefore,
    energy_before: c.energyBefore,
    emotion_before: c.emotionBefore,
    need: c.need,
    intention_met: c.intentionMet,
    pleasant_after: c.pleasantAfter,
    energy_after: c.energyAfter,
    emotion_after: c.emotionAfter,
  };
}

/**
 * Writes a validated check-in: upserts it (restoring one that was cleared), or, when every
 * answer is cleared, soft-deletes it, keeping its last answers (migration 20261003140000).
 * Shared by the prickle page (session client, RLS owner-only) and the Slack DMs (service role,
 * caller has matched the Slack user to `memberId`). Returns the Supabase error, if any.
 */
export async function writeCheckin(
  supabase: SupabaseClient,
  memberId: string,
  prickleId: string,
  checkin: CheckinInput,
  via: "web" | "slack" = "web"
) {
  if (isEmptyCheckin(checkin)) {
    const { error } = await supabase
      .from("prickle_checkins")
      .update({ deleted_at: new Date().toISOString(), saved_via: via })
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .is("deleted_at", null);
    return error ?? null;
  }
  const { error } = await supabase.from("prickle_checkins").upsert(
    {
      member_id: memberId,
      prickle_id: prickleId,
      ...checkinToRow(checkin),
      saved_via: via,
      deleted_at: null,
    },
    { onConflict: "member_id,prickle_id" }
  );
  return error ?? null;
}

/** The "coming in" answers Find a Prickle carries to a prickle's check-in, so it starts pre-filled. */
export type CheckinPrefill = Pick<CheckinInput, "pleasantBefore" | "energyBefore" | "emotionBefore" | "need">;

function prefillParams(prefill: Partial<CheckinPrefill>): URLSearchParams {
  const params = new URLSearchParams();
  if (prefill.pleasantBefore) params.set("pleasant", String(prefill.pleasantBefore));
  if (prefill.energyBefore) params.set("energy", String(prefill.energyBefore));
  if (prefill.emotionBefore) params.set("emotion", prefill.emotionBefore);
  if (prefill.need) params.set("need", prefill.need);
  return params;
}

/**
 * Where a member checks in or out of a prickle: its row on My Prickles' Attendance History, with
 * the check-in / check-out modal open. Slack DMs, notifications and the prickle page link here.
 * `prefill` carries "coming in" answers (e.g. from Find a Prickle) to pre-fill the check-in.
 */
export function checkinHref(prickleId: string, half: "checkin" | "checkout", prefill: Partial<CheckinPrefill> = {}): string {
  const params = new URLSearchParams({ [half]: prickleId });
  for (const [k, v] of prefillParams(prefill)) params.set(k, v);
  return `/my-prickles/history?${params.toString()}`;
}

/**
 * A prickle page link carrying "coming in" answers (e.g. from Find a Prickle). The page passes
 * them on to its check-in link (checkinHref), so the check-in starts pre-filled. Nothing is saved
 * until the member saves.
 */
export function prickleHref(prickleId: string, prefill: Partial<CheckinPrefill>): string {
  const query = prefillParams(prefill).toString();
  return `/prickles/${prickleId}${query ? `?${query}` : ""}`;
}

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

function scaleParam(p: Param): number | null {
  const n = Number(first(p));
  return Number.isInteger(n) && n >= SCALE_MIN && n <= SCALE_MAX ? n : null;
}

/** Reads prickleHref's query back into a check-in prefill. Invalid values are dropped; null when nothing usable is left. */
export function parseCheckinPrefill(params: { pleasant?: Param; energy?: Param; emotion?: Param; need?: Param }): CheckinInput | null {
  const emotionRaw = first(params.emotion) ?? "";
  const needRaw = first(params.need) ?? "";
  const prefill: CheckinPrefill = {
    pleasantBefore: scaleParam(params.pleasant),
    energyBefore: scaleParam(params.energy),
    emotionBefore: (EMOTION_KEYS as readonly string[]).includes(emotionRaw) ? (emotionRaw as Emotion) : null,
    need: (NEED_KEYS as readonly string[]).includes(needRaw) ? (needRaw as Need) : null,
  };
  if (Object.values(prefill).every((v) => v === null)) return null;
  return { ...EMPTY_CHECKIN, ...prefill };
}
