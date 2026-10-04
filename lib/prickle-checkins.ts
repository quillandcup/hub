import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Prickle check-ins: how a member felt coming into a prickle, what they needed from it, and how
 * it went. One row per (member, prickle) in prickle_checkins (migration 20261003000000),
 * readable by the member and admins, never hosts or other members. Clearing every answer
 * soft-deletes the row (deleted_at), so every read filters `deleted_at IS NULL`. The keys below are what's stored; labels can be reworded freely, but adding,
 * removing or renaming a key needs a migration (the table's CHECKs list the same keys --
 * tests/lib/prickle-checkins.test.ts fails if they drift).
 */

/**
 * Energy x pleasantness groups. Never stored: derived from the feeling via FEELING_GROUP, so
 * regrouping applies to past check-ins too. Recommendations pool by group until a single
 * feeling has enough data; the UI only uses groups to space the options, without naming them.
 */
export type FeelingGroup = "charged_up" | "steady" | "running_low" | "wound_up";

export const FEELINGS = [
  { key: "motivated", label: "Motivated", group: "charged_up" },
  { key: "inspired", label: "Inspired", group: "charged_up" },
  { key: "determined", label: "Determined", group: "charged_up" },
  { key: "calm", label: "Calm", group: "steady" },
  { key: "content", label: "Content", group: "steady" },
  { key: "curious", label: "Curious", group: "steady" },
  { key: "tired", label: "Tired", group: "running_low" },
  { key: "drained", label: "Drained", group: "running_low" },
  { key: "meh", label: "Meh / unmotivated", group: "running_low" },
  { key: "stressed", label: "Stressed", group: "wound_up" },
  { key: "anxious", label: "Anxious", group: "wound_up" },
  { key: "overwhelmed", label: "Overwhelmed", group: "wound_up" },
  { key: "frustrated", label: "Frustrated", group: "wound_up" },
  // Don't fit the energy/pleasantness grid, so they never pool: each is a signal on its own
  // (e.g. lonely points straight at the social prickles).
  { key: "stuck", label: "Stuck", group: null },
  { key: "scattered", label: "Scattered", group: null },
  { key: "lonely", label: "Lonely", group: null },
] as const satisfies readonly { key: string; label: string; group: FeelingGroup | null }[];

export type Feeling = (typeof FEELINGS)[number]["key"];

export const FEELING_KEYS: readonly Feeling[] = FEELINGS.map((f) => f.key);

export const FEELING_GROUP: Record<Feeling, FeelingGroup | null> = Object.fromEntries(
  FEELINGS.map((f) => [f.key, f.group])
) as Record<Feeling, FeelingGroup | null>;

/** Feelings in display order, split into their groups (ungrouped ones last, together). */
export const FEELING_DISPLAY_GROUPS: (typeof FEELINGS)[number][][] = (() => {
  const groups: (typeof FEELINGS)[number][][] = [];
  let current: (typeof FEELINGS)[number][] = [];
  let currentGroup: FeelingGroup | null | undefined;
  for (const f of FEELINGS) {
    if (current.length > 0 && f.group !== currentGroup) {
      groups.push(current);
      current = [];
    }
    current.push(f);
    currentGroup = f.group;
  }
  if (current.length > 0) groups.push(current);
  return groups;
})();

export const MAX_FEELINGS = 2;

export const NEEDS = [
  { key: "momentum", label: "Momentum", hint: "Get words down" },
  { key: "deep_focus", label: "Deep focus", hint: "Heads-down, no distractions" },
  { key: "accountability", label: "Accountability", hint: "Just show up and do something" },
  { key: "company", label: "Company", hint: "Work alongside people" },
  { key: "gentle", label: "Gentle", hint: "Low pressure, fill my cup" },
  { key: "unstick", label: "Unstick", hint: "Talk it through or brainstorm" },
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
  gentle: "balanced",
  unstick: "chatty",
};

export const NEED_KEYS: readonly Need[] = NEEDS.map((n) => n.key);

export const SESSION_RATINGS = [
  { value: 1, label: "Rough" },
  { value: 2, label: "Meh" },
  { value: 3, label: "OK" },
  { value: 4, label: "Good" },
  { value: 5, label: "Great" },
] as const;

/**
 * A prickle check-in has two halves, asked at different times, in Slack DMs
 * (lib/prickle-checkin-dms.ts) and on the site alike:
 * - Check-in, coming in: how they're feeling (feelingsBefore) and what they need (need).
 * - Check-out, afterwards: how it went (sessionRating) and how they feel now (feelingsAfter).
 * Both are stored on the same prickle_checkins row.
 *
 * On the site, the prickle page is where both halves live and stay editable any time: the
 * check-in always, the check-out once the prickle has started. The Log Progress
 * modal asks only the check-out and links to the page for the check-in. The Slack DMs keep their
 * own timing (check-in ~20 min before, check-out 5 min after the end or 10 min after leaving early).
 */
export interface CheckinInput {
  feelingsBefore: Feeling[];
  need: Need | null;
  sessionRating: number | null;
  feelingsAfter: Feeling[];
}

export function isEmptyCheckin(c: CheckinInput): boolean {
  return c.feelingsBefore.length === 0 && c.need === null && c.sessionRating === null && c.feelingsAfter.length === 0;
}

/** Validates untrusted input (server actions are public POST endpoints); returns an error message or null. */
export function validateCheckin(input: unknown): string | null {
  if (!input || typeof input !== "object") return "Invalid check-in";
  const c = input as Record<string, unknown>;
  for (const field of ["feelingsBefore", "feelingsAfter"] as const) {
    const value = c[field];
    if (!Array.isArray(value)) return "Invalid feelings";
    if (value.length > MAX_FEELINGS) return `Pick up to ${MAX_FEELINGS} feelings`;
    if (new Set(value).size !== value.length) return "Invalid feelings";
    if (!value.every((v) => (FEELING_KEYS as readonly unknown[]).includes(v))) return "Invalid feelings";
  }
  if (c.need !== null && !(NEED_KEYS as readonly unknown[]).includes(c.need)) return "Invalid need";
  if (
    c.sessionRating !== null &&
    !(typeof c.sessionRating === "number" && Number.isInteger(c.sessionRating) && c.sessionRating >= 1 && c.sessionRating <= 5)
  ) {
    return "Invalid rating";
  }
  return null;
}

/**
 * Whether the check-in half is fully answered. A partly answered check-in is still offered, to
 * finish it (the Slack check-in DM is sent for one too).
 */
export function checkinAnswered(saved: CheckinInput | null): boolean {
  return !!saved && saved.feelingsBefore.length > 0 && saved.need !== null;
}

/** Same for the check-out half. */
export function checkoutAnswered(saved: CheckinInput | null): boolean {
  return !!saved && saved.sessionRating !== null && saved.feelingsAfter.length > 0;
}

/** A prickle_checkins row's answers (live rows only: callers filter `deleted_at IS NULL`). */
export function checkinFromRow(row: {
  feelings_before: string[] | null;
  need: string | null;
  session_rating: number | null;
  feelings_after: string[] | null;
}): CheckinInput {
  return {
    feelingsBefore: (row.feelings_before ?? []) as Feeling[],
    need: (row.need ?? null) as Need | null,
    sessionRating: row.session_rating ?? null,
    feelingsAfter: (row.feelings_after ?? []) as Feeling[],
  };
}

/**
 * Writes a validated check-in: upserts it (restoring one that was cleared), or, when every
 * answer is cleared, soft-deletes it, keeping its last answers (migration 20261003140000).
 * Shared by the prickle page (session client, RLS owner-only) and the Slack DMs (service role,
 * caller has matched the Slack user to `memberId`). Returns the Supabase error, if any.
 */
export async function writeCheckin(supabase: SupabaseClient, memberId: string, prickleId: string, checkin: CheckinInput) {
  if (isEmptyCheckin(checkin)) {
    const { error } = await supabase
      .from("prickle_checkins")
      .update({ deleted_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .is("deleted_at", null);
    return error ?? null;
  }
  const { error } = await supabase.from("prickle_checkins").upsert(
    {
      member_id: memberId,
      prickle_id: prickleId,
      feelings_before: checkin.feelingsBefore,
      need: checkin.need,
      session_rating: checkin.sessionRating,
      feelings_after: checkin.feelingsAfter,
      deleted_at: null,
    },
    { onConflict: "member_id,prickle_id" }
  );
  return error ?? null;
}

/** Toggles a feeling in a selection capped at MAX_FEELINGS; at the cap, a new pick is ignored. */
export function toggleFeeling(selected: Feeling[], feeling: Feeling): Feeling[] {
  if (selected.includes(feeling)) return selected.filter((f) => f !== feeling);
  if (selected.length >= MAX_FEELINGS) return selected;
  return [...selected, feeling];
}

/**
 * A prickle page link carrying "coming in" answers (e.g. from Find a Prickle), so the
 * check-in card there starts pre-filled. Nothing is saved until the member saves the card.
 */
export function prickleHref(prickleId: string, feelings: Feeling[], need: Need | null): string {
  const params = new URLSearchParams();
  if (feelings.length > 0) params.set("feel", feelings.join(","));
  if (need) params.set("need", need);
  const query = params.toString();
  return `/prickles/${prickleId}${query ? `?${query}` : ""}`;
}

/**
 * Reads prickleHref's query back into a check-in prefill. Unknown keys are dropped and feelings
 * capped at MAX_FEELINGS; null when nothing usable is left.
 */
export function parseCheckinPrefill(params: {
  feel?: string | string[];
  need?: string | string[];
}): CheckinInput | null {
  const feelRaw = Array.isArray(params.feel) ? params.feel[0] : params.feel;
  const needRaw = Array.isArray(params.need) ? params.need[0] : params.need;
  const feelings = [...new Set((feelRaw ?? "").split(","))]
    .filter((f): f is Feeling => (FEELING_KEYS as readonly string[]).includes(f))
    .slice(0, MAX_FEELINGS);
  const need = (NEED_KEYS as readonly string[]).includes(needRaw ?? "") ? (needRaw as Need) : null;
  if (feelings.length === 0 && need === null) return null;
  return { feelingsBefore: feelings, need, sessionRating: null, feelingsAfter: [] };
}
