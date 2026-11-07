
/**
 * Prickle check-ins: how a member feels coming into a prickle and leaving it, what they came for,
 * and whether they got it. One row per (member, prickle) in prickle_checkins (migration
 * 20261003000000, reshaped by 20261220000000), readable by the member and admins, never hosts or
 * other members. Clearing every answer soft-deletes the row (deleted_at), so every read filters
 * `deleted_at IS NULL`. The keys below are what's stored; labels can be reworded freely, but
 * adding, removing or renaming a key needs a migration (the table's CHECKs list the same keys --
 * tests/lib/prickle-checkins.test.ts fails if they drift). Why these questions: docs/CHECKINS.md.
 */

/**
 * What a check-out says to a member with no writing goal, wherever it is shown (the Slack message,
 * the email, the web check-out): short enough for one line on a phone, and plain that it is for
 * next time. It links to their projects, where goals are set.
 */
export const NO_GOAL_TIP = "💡 Next time: set a goal to log progress here";
export const NO_GOAL_TIP_PATH = "/projects";

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

/** How many of a member's usual feelings the Slack DM lists on top; the site shows more. */
export const SLACK_FREQUENT_EMOTIONS = 3;
/** How many the site's feeling picker lists as "Frequently used". */
export const WEB_FREQUENT_EMOTIONS = 8;

/**
 * The feelings a member names most, most used first (before and after answers both count), like
 * a keyboard's frequent emojis: nothing to set up, it follows what they pick. Ties keep the
 * wheel's order, so the list doesn't shuffle between sends. Values that aren't on the wheel are skipped.
 */
export function frequentEmotions(
  answers: Iterable<{ emotionBefore: string | null; emotionAfter: string | null }>,
  limit: number
): Emotion[] {
  const counts = new Map<Emotion, number>();
  for (const a of answers) {
    for (const e of [a.emotionBefore, a.emotionAfter]) {
      if (e && (EMOTION_KEYS as readonly string[]).includes(e)) counts.set(e as Emotion, (counts.get(e as Emotion) ?? 0) + 1);
    }
  }
  return EMOTION_KEYS.filter((e) => counts.has(e))
    .sort((a, b) => counts.get(b)! - counts.get(a)!)
    .slice(0, Math.max(0, limit));
}

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

/**
 * Common words that aren't on the wheel, each with its closest wheel words, best first. Searching
 * one suggests those (EmotionPicker), and the retired check-in feelings were carried over to their
 * first suggestion (migration 20261220000000). Grow it from what members search for.
 * - stuck: being stuck is treated as frustration in Feelings Wheel 2.0; it can also feel like
 *   discouragement or helplessness.
 * - burned out: the three dimensions of burnout in Maslach's model, exhaustion, detachment
 *   (cynicism) and reduced efficacy.
 */
export const EMOTION_SUGGESTIONS: Readonly<Record<string, readonly Emotion[]>> = {
  stuck: ["frustrated", "discouraged", "helpless"],
  hopeless: ["discouraged", "helpless", "depressed"],
  stressed: ["anxious", "helpless", "frustrated"],
  overwhelmed: ["helpless", "anxious"],
  "burned out": ["sleepy", "apathetic", "inadequate"],
  "burnt out": ["sleepy", "apathetic", "inadequate"],
  burnout: ["sleepy", "apathetic", "inadequate"],
  motivated: ["energetic", "hopeful"],
  calm: ["serene", "relaxed"],
  tired: ["sleepy"],
  meh: ["apathetic", "bored"],
  unmotivated: ["apathetic", "bored"],
  happy: ["cheerful", "delightful"],
};

/** One search result: a wheel word, and the word it was suggested for when it didn't match itself. */
export interface EmotionSearchResult {
  emotion: Emotion;
  suggestedFor?: string;
}

const SEARCH_LIMIT = 10;

/**
 * Search the wheel: words whose name (or core's name) contains the term first, then the
 * suggestions for any common word the term matches (EMOTION_SUGGESTIONS), skipping repeats.
 */
export function searchEmotions(term: string): EmotionSearchResult[] {
  const needle = term.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return [];
  const results: EmotionSearchResult[] = EMOTION_KEYS.filter(
    (e) => e.includes(needle) || EMOTION_CORE[e].includes(needle)
  ).map((emotion) => ({ emotion }));
  const seen = new Set(results.map((r) => r.emotion));
  for (const [word, emotions] of Object.entries(EMOTION_SUGGESTIONS)) {
    // "stu" and "feeling stuck" both reach "stuck"; a two-letter fragment doesn't.
    const matches = (needle.length >= 3 && word.startsWith(needle)) || needle.includes(word);
    if (!matches) continue;
    for (const emotion of emotions) {
      if (seen.has(emotion)) continue;
      seen.add(emotion);
      results.push({ emotion, suggestedFor: word });
    }
  }
  return results.slice(0, SEARCH_LIMIT);
}

/**
 * The feelings the first check-in design offered (migration 20261005000000), each with the wheel
 * word it was carried over to: the same word when it's on the wheel, else its first suggestion.
 */
export const LEGACY_FEELINGS = [
  "motivated",
  "calm",
  "content",
  "tired",
  "meh",
  "stressed",
  "anxious",
  "overwhelmed",
  "frustrated",
  "stuck",
  "lonely",
] as const;

export const LEGACY_FEELING_TO_EMOTION: Readonly<Record<(typeof LEGACY_FEELINGS)[number], Emotion>> = Object.fromEntries(
  LEGACY_FEELINGS.map((f) => [f, (EMOTION_KEYS as readonly string[]).includes(f) ? (f as Emotion) : EMOTION_SUGGESTIONS[f][0]])
) as Record<(typeof LEGACY_FEELINGS)[number], Emotion>;

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

/** Every question, by CheckinInput key, in the order they are asked. */
export const CHECKIN_ANSWER_KEYS = [
  "pleasantBefore",
  "energyBefore",
  "emotionBefore",
  "need",
  "intentionMet",
  "pleasantAfter",
  "energyAfter",
  "emotionAfter",
] as const;

export type CheckinAnswerKey = (typeof CHECKIN_ANSWER_KEYS)[number];

/** The prickle_checkins column each question is stored in, which is also how `skipped` names them (migration 20270518000000). */
export const CHECKIN_FIELDS: Record<CheckinAnswerKey, string> = {
  pleasantBefore: "pleasant_before",
  energyBefore: "energy_before",
  emotionBefore: "emotion_before",
  need: "need",
  intentionMet: "intention_met",
  pleasantAfter: "pleasant_after",
  energyAfter: "energy_after",
  emotionAfter: "emotion_after",
};

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
  /**
   * The questions the member skipped ("I'd rather not say"): a skipped question counts as dealt
   * with, so a half whose questions are all answered or skipped is done (checkinAnswered). Never
   * also answered: patchCheckin keeps the two apart.
   */
  skipped: CheckinAnswerKey[];
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
  skipped: [],
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
  const fields: readonly CheckinAnswerKey[] = CHECKIN_HALF_FIELDS[half];
  const next = { ...base } as Record<keyof CheckinInput, unknown>;
  for (const field of fields) next[field] = answers[field] ?? null;
  // The other half's skips stay; this half's are replaced by the ones in `answers`.
  next.skipped = [...base.skipped.filter((k) => !fields.includes(k)), ...(answers.skipped ?? []).filter((k) => fields.includes(k))];
  return next as unknown as CheckinInput;
}

/** One half's answers, e.g. to save just that half. */
export function halfOf(c: CheckinInput, half: "checkin" | "checkout"): Partial<CheckinInput> {
  const fields: readonly CheckinAnswerKey[] = CHECKIN_HALF_FIELDS[half];
  return { ...Object.fromEntries(fields.map((f) => [f, c[f]])), skipped: c.skipped.filter((k) => fields.includes(k)) };
}

/** Nothing answered and nothing skipped (a check-in like that is not kept). */
export function isEmptyCheckin(c: CheckinInput): boolean {
  return c.skipped.length === 0 && CHECKIN_ANSWER_KEYS.every((k) => c[k] === null);
}

/**
 * `patch` applied to a check-in the way the questions behave: skipping a question clears its
 * answer, answering one lifts its skip. Returns the patch to merge (`{ ...draft, ...result }`), so
 * every form handles skips the same way.
 */
export function skipAwarePatch(base: CheckinInput, patch: Partial<CheckinInput>): Partial<CheckinInput> {
  const skipped = new Set(patch.skipped ?? base.skipped);
  const out: Partial<CheckinInput> = { ...patch };
  for (const key of CHECKIN_ANSWER_KEYS) {
    if (patch[key] != null) skipped.delete(key);
    else if (patch.skipped?.includes(key)) (out as Record<string, unknown>)[key] = null;
  }
  out.skipped = CHECKIN_ANSWER_KEYS.filter((k) => skipped.has(k));
  return out;
}

/** The patch that skips a question, or, when it is already skipped, takes the skip back. */
export function toggleSkipPatch(base: CheckinInput, key: CheckinAnswerKey): Partial<CheckinInput> {
  const skipped = base.skipped.includes(key) ? base.skipped.filter((k) => k !== key) : [...base.skipped, key];
  return skipAwarePatch(base, { skipped });
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
  const skipped = c.skipped;
  if (!Array.isArray(skipped) || skipped.some((k) => !(CHECKIN_ANSWER_KEYS as readonly unknown[]).includes(k)) || new Set(skipped).size !== skipped.length) {
    return "Invalid skip";
  }
  if (skipped.some((k) => c[k as CheckinAnswerKey] != null)) return "A question can't be both answered and skipped";
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
  return !!saved && (["pleasantBefore", "energyBefore", "need"] as const).every((k) => dealtWith(saved, k));
}

/** A question is dealt with once it is answered or skipped. */
function dealtWith(c: CheckinInput, key: CheckinAnswerKey): boolean {
  return c[key] !== null || c.skipped.includes(key);
}

/** Same for the check-out half: got what they came for, and mood. */
export function checkoutAnswered(saved: CheckinInput | null): boolean {
  return !!saved && (["intentionMet", "pleasantAfter", "energyAfter"] as const).every((k) => dealtWith(saved, k));
}

/**
 * Whether check-ins and check-outs are paused for a prickle: Pop-Up Prickles (source "zoom"). Their
 * rows only exist once processing has covered their room, and were rebuilt under a new id when a
 * run changed their end, which sent the same check-out again and lost saved answers (docs/TODO.md,
 * "Check-ins and check-outs for Pop-Up Prickles"). Every sender and every offer asks this, so they
 * can't drift: the DMs and the dashboard card (through offersCheckins), the pills and the search
 * palette (checkinOffered).
 */
export function checkinsPausedFor(prickle: { source: string }): boolean {
  return prickle.source === "zoom";
}

/** Whether the DMs and the dashboard's "How did it go?" card cover a prickle: a writing prickle, and not one the check-ins are paused for. */
export function offersCheckins(prickle: { source: string; type?: { purpose: string } | null }): boolean {
  return prickle.type?.purpose === "writing" && !checkinsPausedFor(prickle);
}

/** The prickle_checkins columns holding the answers, for selects. */
export const CHECKIN_COLUMNS =
  "pleasant_before, energy_before, emotion_before, need, intention_met, pleasant_after, energy_after, emotion_after, skipped";

export interface CheckinRow {
  pleasant_before: number | null;
  energy_before: number | null;
  emotion_before: string | null;
  need: string | null;
  intention_met: number | null;
  pleasant_after: number | null;
  energy_after: number | null;
  emotion_after: string | null;
  skipped: string[];
}

/** A prickle_checkins row's answers (live rows only: callers filter `deleted_at IS NULL`). */
export function checkinFromRow(row: CheckinRow): CheckinInput {
  return {
    skipped: CHECKIN_ANSWER_KEYS.filter((k) => (row.skipped ?? []).includes(CHECKIN_FIELDS[k])),
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
    skipped: CHECKIN_ANSWER_KEYS.filter((k) => c.skipped.includes(k)).map((k) => CHECKIN_FIELDS[k]),
  };
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
