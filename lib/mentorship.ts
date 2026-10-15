import type { SupabaseClient } from "@supabase/supabase-js";
import { quarterKey } from "@/lib/badges";

// The Big Sister program: every new member (a trial, a direct sign-up, someone rejoining, someone
// arriving through a program that includes membership) is matched with an existing member for 30
// days (mentorships table). For a trial, whether it converted is derived here from the membership
// data the pipeline already computes (members.first_joined_at / most_recent_joined_at / status),
// never stored, so it can't drift from Kajabi/Stripe.

/** A mentorship lasts this long from the day the new member's membership began: enough for a
 * 7-day trial, the rare month-long one, a program's first deliverable, or a direct sign-up. */
export const MENTORSHIP_DAYS = 30;

/** The big sister can still record why a trial didn't continue until this many days after it began
 * (a month-long trial isn't known to have failed until after the 30 days are up). */
export const NOTE_WINDOW_DAYS = 60;

/** How long after a trial ends to wait before calling it "not converted": the first charge and
 * the membership pipeline need a little time to show it. */
export const BILLING_GRACE_DAYS = 3;

/** A membership that starts within this many days of the trial's start counts as the trial
 * converting. Later than that is the person coming back on their own, not the trial. */
export const CONVERSION_WINDOW_DAYS = 90;

/** A membership dated up to this many days before the trial's start still counts (the first
 * charge can be dated just ahead of the sign-up we recorded). */
const START_SLACK_DAYS = 7;

export type MentorshipStatus = "matched" | "reassigned";
/** How the new member arrived: a Stripe trial, a membership with no trial, or a program that
 * includes membership. Only a trial has an outcome to track. */
export type MentorshipKind = "trial" | "direct" | "program";

/** converted / in_trial / not_converted apply to a trial; no_trial is everyone else. */
export type MentorshipOutcome = "converted" | "in_trial" | "not_converted" | "no_trial";

/** The slice of a new member's `members` row the outcome is derived from. */
export interface TrialMemberJoin {
  status: string | null;
  firstJoinedAt: string | null;
  mostRecentJoinedAt: string | null;
}

export interface OutcomeResult {
  outcome: MentorshipOutcome;
  /** When the membership began (the trial ended), if they converted. */
  convertedOn: string | null;
  /** A current member (active, or on hiatus) today. */
  currentMember: boolean;
}

const MS_PER_DAY = 86_400_000;

function dayNumber(dateOnly: string): number {
  return Math.floor(Date.parse(`${dateOnly.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY);
}

/** `today` as YYYY-MM-DD in UTC, the day boundary every date here is compared on. */
export function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The last day (YYYY-MM-DD) of a mentorship that began on `startedOn`. */
export function mentorshipEndsOn(startedOn: string): string {
  return new Date((dayNumber(startedOn) + MENTORSHIP_DAYS - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whether a mentorship that began on `startedOn` is still running on `today`. */
export function isMentorshipActive(startedOn: string, today: string): boolean {
  return dayNumber(today) >= dayNumber(startedOn) && dayNumber(today) < dayNumber(startedOn) + MENTORSHIP_DAYS;
}

/**
 * Did the trial that began on `startedOn` turn into a membership? (Anyone who didn't arrive on a
 * trial has no outcome to derive: `no_trial`.)
 *
 * members.first_joined_at is the first real (billed) stint, so a trial cancelled before it was
 * billed never sets it. Someone new to the community has only that one date. A returning member
 * has an older first_joined_at, so their most recent join is the one that can belong to this
 * trial. A join counts when it falls inside [start - slack, start + CONVERSION_WINDOW_DAYS].
 *
 * With no such join the trial is "in trial" until BILLING_GRACE_DAYS after it ends
 * (`trialEndsOn`, from Stripe), then it did not convert. No `trialEndsOn` on a trial (a row from the
 * old spreadsheet) means the length is unknown, and a trial is never assumed: only the grace period
 * after the start applies.
 */
export function deriveOutcome(
  kind: MentorshipKind,
  startedOn: string,
  trialEndsOn: string | null,
  member: TrialMemberJoin | null | undefined,
  today: string
): OutcomeResult {
  const currentMember = member?.status === "active" || member?.status === "on_hiatus";
  if (kind !== "trial") return { outcome: "no_trial", convertedOn: null, currentMember };
  const start = dayNumber(startedOn);
  const fits = (joined: string | null): joined is string => {
    if (!joined) return false;
    const day = dayNumber(joined);
    return day >= start - START_SLACK_DAYS && day <= start + CONVERSION_WINDOW_DAYS;
  };

  const convertedOn = [member?.firstJoinedAt ?? null, member?.mostRecentJoinedAt ?? null].find(fits) ?? null;
  if (convertedOn) {
    return {
      outcome: "converted",
      convertedOn: convertedOn.slice(0, 10),
      currentMember,
    };
  }
  const decidedOn = (trialEndsOn ? dayNumber(trialEndsOn) : start) + BILLING_GRACE_DAYS;
  const pending = dayNumber(today) < decidedOn;
  return { outcome: pending ? "in_trial" : "not_converted", convertedOn: null, currentMember: false };
}

export interface MentorshipRow {
  id: string;
  mentorMemberId: string;
  mentorName: string;
  newMemberId: string;
  newMemberName: string;
  /** The day their membership began (sign-up, or the program cohort's start). */
  startedOn: string;
  /** From Stripe, for a trial; null otherwise. */
  trialEndsOn: string | null;
  kind: MentorshipKind;
  status: MentorshipStatus;
  /** The mentorship's 30 days haven't run out yet. */
  active: boolean;
  outcomeNote: string | null;
  outcome: MentorshipOutcome;
  convertedOn: string | null;
  currentMember: boolean;
}

export interface MentorStats {
  mentorMemberId: string;
  mentorName: string;
  total: number;
  /** Trials only: converted / did not convert / not decided yet. */
  converted: number;
  notConverted: number;
  inTrial: number;
  /** New members who didn't arrive on a trial: nothing to convert. */
  noTrial: number;
  currentMembers: number;
  /** converted / (converted + notConverted); null until one trial has been decided. */
  conversionRate: number | null;
  lastStartedOn: string;
}

export interface PeriodStats {
  /** "YYYY-Qn" of the start. */
  period: string;
  total: number;
  converted: number;
  notConverted: number;
  inTrial: number;
  noTrial: number;
  conversionRate: number | null;
}

export function conversionRate(converted: number, notConverted: number): number | null {
  const decided = converted + notConverted;
  return decided === 0 ? null : converted / decided;
}

/** Matches that count: a reassigned match never happened as far as stats go. */
function counted(rows: MentorshipRow[]): MentorshipRow[] {
  return rows.filter((r) => r.status === "matched");
}

type Tally = Pick<PeriodStats, "total" | "converted" | "notConverted" | "inTrial" | "noTrial">;

function emptyTally(): Tally {
  return { total: 0, converted: 0, notConverted: 0, inTrial: 0, noTrial: 0 };
}

function addToTally(tally: Tally, row: MentorshipRow) {
  tally.total += 1;
  if (row.outcome === "converted") tally.converted += 1;
  else if (row.outcome === "not_converted") tally.notConverted += 1;
  else if (row.outcome === "in_trial") tally.inTrial += 1;
  else tally.noTrial += 1;
}

/** Per big sister: how many new members she has had and how many trials converted. Most new
 * members first, ties by conversion. */
export function computeMentorStats(rows: MentorshipRow[]): MentorStats[] {
  const byMentor = new Map<string, MentorStats>();
  for (const row of counted(rows)) {
    const stats = byMentor.get(row.mentorMemberId) ?? {
      mentorMemberId: row.mentorMemberId,
      mentorName: row.mentorName,
      ...emptyTally(),
      currentMembers: 0,
      conversionRate: null,
      lastStartedOn: row.startedOn,
    };
    addToTally(stats, row);
    if (row.currentMember) stats.currentMembers += 1;
    if (row.startedOn > stats.lastStartedOn) stats.lastStartedOn = row.startedOn;
    byMentor.set(row.mentorMemberId, stats);
  }
  for (const stats of byMentor.values()) {
    stats.conversionRate = conversionRate(stats.converted, stats.notConverted);
  }
  return [...byMentor.values()].sort(
    (a, b) => b.total - a.total || (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || a.mentorName.localeCompare(b.mentorName)
  );
}

/** The program's conversion by calendar quarter of the start, oldest first: the trend. */
export function computePeriodStats(rows: MentorshipRow[]): PeriodStats[] {
  const byPeriod = new Map<string, PeriodStats>();
  for (const row of counted(rows)) {
    const period = quarterKey(`${row.startedOn}T12:00:00Z`);
    const stats = byPeriod.get(period) ?? { period, ...emptyTally(), conversionRate: null };
    addToTally(stats, row);
    byPeriod.set(period, stats);
  }
  for (const stats of byPeriod.values()) {
    stats.conversionRate = conversionRate(stats.converted, stats.notConverted);
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** Overall totals across every counted match. */
export function computeOverallStats(rows: MentorshipRow[]): Omit<PeriodStats, "period"> {
  const tally = emptyTally();
  for (const row of counted(rows)) addToTally(tally, row);
  return { ...tally, conversionRate: conversionRate(tally.converted, tally.notConverted) };
}

/** Big sisters with a new member still inside their 30 days, so a new match can warn that the
 * program prefers one at a time. Keyed by mentor member id, value = how many. */
export function openLoadByMentor(rows: MentorshipRow[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const row of counted(rows)) {
    if (row.active) load.set(row.mentorMemberId, (load.get(row.mentorMemberId) ?? 0) + 1);
  }
  return load;
}

interface MemberEmbed {
  id: string;
  name: string;
  status: string | null;
  first_joined_at: string | null;
  most_recent_joined_at: string | null;
}

interface MentorshipDbRow {
  id: string;
  mentor_member_id: string;
  new_member_id: string;
  started_on: string;
  trial_ends_on: string | null;
  kind: MentorshipKind;
  status: MentorshipStatus;
  outcome_note: string | null;
  mentor: MemberEmbed | MemberEmbed[] | null;
  new_member: MemberEmbed | MemberEmbed[] | null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Turns joined DB rows into MentorshipRows with the derived outcome. Pure, for tests. */
export function toMentorshipRows(dbRows: MentorshipDbRow[], today: string): MentorshipRow[] {
  return dbRows.map((r) => {
    const mentor = one(r.mentor);
    const newMember = one(r.new_member);
    const result = deriveOutcome(
      r.kind,
      r.started_on,
      r.trial_ends_on,
      newMember && {
        status: newMember.status,
        firstJoinedAt: newMember.first_joined_at,
        mostRecentJoinedAt: newMember.most_recent_joined_at,
      },
      today
    );
    return {
      id: r.id,
      mentorMemberId: r.mentor_member_id,
      mentorName: mentor?.name ?? "Unknown member",
      newMemberId: r.new_member_id,
      newMemberName: newMember?.name ?? "Unknown member",
      startedOn: r.started_on,
      trialEndsOn: r.trial_ends_on,
      kind: r.kind,
      status: r.status,
      active: isMentorshipActive(r.started_on, today),
      outcomeNote: r.outcome_note,
      ...result,
    };
  });
}

const MEMBER_COLUMNS = "id, name, status, first_joined_at, most_recent_joined_at";

/** Every match (newest first) with names and the derived outcome. Paginated per CLAUDE.md. */
export async function getMentorships(supabase: SupabaseClient, today: string): Promise<MentorshipRow[]> {
  const BATCH_SIZE = 1000;
  const all: MentorshipDbRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("mentorships")
      .select(
        `id, mentor_member_id, new_member_id, started_on, trial_ends_on, kind, status, outcome_note,
         mentor:members!mentorships_mentor_member_id_fkey(${MEMBER_COLUMNS}),
         new_member:members!mentorships_new_member_id_fkey(${MEMBER_COLUMNS})`
      )
      .order("started_on", { ascending: false })
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      all.push(...(batch as unknown as MentorshipDbRow[]));
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return toMentorshipRows(all, today);
}

export interface MatchInput {
  mentorMemberId: string;
  newMemberId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the two members chosen in the admin form before the match is made. The start date isn't
 * entered: it comes from the new member's sign-up (lib/arrivals.ts). */
export function parseMatchInput(raw: {
  mentorMemberId?: string | null;
  newMemberId?: string | null;
}): { ok: true; value: MatchInput } | { ok: false; error: string } {
  const { mentorMemberId, newMemberId } = raw;
  if (!mentorMemberId || !UUID.test(mentorMemberId)) return { ok: false, error: "Choose a big sister." };
  if (!newMemberId || !UUID.test(newMemberId)) return { ok: false, error: "Choose a new member." };
  if (mentorMemberId === newMemberId) return { ok: false, error: "A member can't be their own big sister." };
  return { ok: true, value: { mentorMemberId, newMemberId } };
}
