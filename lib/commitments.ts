// Commitments: a member's promise to attend one recurring prickle slot for N weeks
// (see docs/COMMITMENTS.md and the prickle_commitments migration). This module is pure and
// DB-free -- window/occurrence math, slot matching, kept/missed progress, and input
// validation -- so it's easy to unit test (tests/lib/commitments.test.ts). The server
// actions in app/(member)/my-prickles/commitment-actions.ts do the fetching.

import { formatScheduleLabel, zonedTimeToUtc } from "@/lib/prickle-schedules";

export type CommitmentStatus = "active" | "completed" | "cancelled";

export const MIN_COMMITMENT_WEEKS = 1;
export const MAX_COMMITMENT_WEEKS = 12;
export const DEFAULT_COMMITMENT_WEEKS = 4;
/** How far ahead a commitment may start -- enough to plan next month, not a far-future placeholder. */
export const MAX_START_DAYS_AHEAD = 60;

/**
 * How far a prickle's start may drift from the committed wall-clock time and still count as
 * that week's occurrence. 60 minutes covers the one case that routinely happens: the member's
 * timezone and the org's (ET) switch DST on different dates (e.g. Europe/London vs.
 * America/New_York for ~1 week each spring and fall), so an unchanged 7am ET prickle lands an
 * hour off the member's committed local time. When several same-type prickles fall inside the
 * tolerance, the closest one wins, so an adjacent-hour slot of the same type only matches when
 * the committed one didn't happen at all.
 */
export const MATCH_TOLERANCE_MINUTES = 60;

/**
 * Attendance is imported after a prickle ends (Zoom webhook on meeting end, plus the nightly
 * reconcile), so an unattended occurrence that ended recently isn't "missed" yet -- it's
 * pending until this grace period passes.
 */
export const ATTENDANCE_GRACE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A recurring slot, identified the same way as prickle_schedules (type + weekday + local time + timezone). */
export interface CommitmentSlot {
  typeId: string;
  dayOfWeek: number; // 0=Sunday..6=Saturday
  startTimeLocal: string; // "HH:MM" or "HH:MM:SS"
  timezone: string;
}

export interface Commitment extends CommitmentSlot {
  id: string;
  startDate: string; // ISO date
  weeks: number;
  status: CommitmentStatus;
  cancelledAt: string | null;
}

export interface SlotPrickle {
  id: string;
  typeId: string | null;
  startTime: string;
  endTime: string;
}

export type OccurrenceStatus =
  | "kept" // attended at least once
  | "missed" // happened, not attended, grace period over
  | "pending" // happened recently, not attended (yet) -- attendance may not be imported
  | "upcoming" // hasn't started yet
  | "no_session"; // no matching prickle ran that week (e.g. holiday) -- not held against the member

export interface CommitmentOccurrence {
  date: string; // local ISO date in the commitment's timezone
  expectedStart: string; // UTC ISO instant of the committed wall-clock time that date
  prickleId: string | null;
  status: OccurrenceStatus;
}

export interface CommitmentProgress {
  occurrences: CommitmentOccurrence[];
  kept: number;
  missed: number;
  pending: number;
  upcoming: number;
  noSession: number;
  effectiveStatus: CommitmentStatus;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return isoDate(new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS));
}

function normalizeTime(timeLocal: string): string {
  return timeLocal.slice(0, 5);
}

/** The first date on/after `startDate` falling on `dayOfWeek` (pure calendar-date math, no timezone). */
export function firstOccurrenceDate(startDate: string, dayOfWeek: number): string {
  const startDow = new Date(`${startDate}T00:00:00Z`).getUTCDay();
  return addDays(startDate, (dayOfWeek - startDow + 7) % 7);
}

/** Last day of the commitment window -- mirrors the generated end_date column. */
export function commitmentEndDate(startDate: string, weeks: number): string {
  return addDays(startDate, weeks * 7 - 1);
}

/** The `weeks` local calendar dates this commitment covers, one per week. */
export function commitmentOccurrenceDates(c: Pick<Commitment, "startDate" | "dayOfWeek" | "weeks">): string[] {
  const first = firstOccurrenceDate(c.startDate, c.dayOfWeek);
  return Array.from({ length: c.weeks }, (_, i) => addDays(first, i * 7));
}

/** The committed wall-clock time on `date`, as a UTC instant (DST-aware for the commitment's timezone). */
export function expectedOccurrenceStart(date: string, slot: Pick<CommitmentSlot, "startTimeLocal" | "timezone">): Date {
  return zonedTimeToUtc(date, normalizeTime(slot.startTimeLocal), slot.timezone);
}

/** Local weekday + "HH:MM" for an instant in `timeZone` -- how a schedule row becomes a slot. */
export function slotTimeForInstant(iso: string, timeZone: string): { dayOfWeek: number; startTimeLocal: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { dayOfWeek: DAY_ABBR.indexOf(get("weekday")), startTimeLocal: `${hour}:${get("minute")}` };
}

/** Local ISO date for an instant in `timeZone`. */
export function localDateFor(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The commitment slot a schedule row (from getPrickleScheduleOverview) represents, as seen in `timeZone`. */
export function slotFromScheduleRow(
  row: { typeId: string | null; nextOccurrenceStart: string },
  timeZone: string
): CommitmentSlot | null {
  if (!row.typeId) return null;
  return { typeId: row.typeId, ...slotTimeForInstant(row.nextOccurrenceStart, timeZone), timezone: timeZone };
}

/** Exact slot match: same type, same local weekday and start time in the slot's timezone. */
export function prickleMatchesSlot(prickle: Pick<SlotPrickle, "typeId" | "startTime">, slot: CommitmentSlot): boolean {
  if (prickle.typeId !== slot.typeId) return false;
  const local = slotTimeForInstant(prickle.startTime, slot.timezone);
  return local.dayOfWeek === slot.dayOfWeek && local.startTimeLocal === normalizeTime(slot.startTimeLocal);
}

/** The same-type prickle closest to `expected`, within the tolerance; null if none ran. */
export function matchOccurrencePrickle(
  expected: Date,
  typeId: string,
  prickles: SlotPrickle[],
  toleranceMinutes: number = MATCH_TOLERANCE_MINUTES
): SlotPrickle | null {
  const toleranceMs = toleranceMinutes * 60 * 1000;
  let best: SlotPrickle | null = null;
  let bestDelta = Infinity;
  for (const p of prickles) {
    if (p.typeId !== typeId) continue;
    const delta = Math.abs(new Date(p.startTime).getTime() - expected.getTime());
    if (delta <= toleranceMs && delta < bestDelta) {
      best = p;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Distinct attended prickle ids from raw prickle_attendance rows. A member can leave and rejoin
 * (multiple rows per prickle, see CLAUDE.md), but a week is kept once no matter how many rows.
 */
export function buildAttendedSet(rows: { prickle_id: string }[]): Set<string> {
  return new Set(rows.map((r) => r.prickle_id));
}

/** Stored status, except an 'active' commitment whose last occurrence date has passed reads as 'completed'. */
export function effectiveCommitmentStatus(
  c: Pick<Commitment, "status" | "startDate" | "weeks" | "timezone">,
  now: Date
): CommitmentStatus {
  if (c.status !== "active") return c.status;
  return localDateFor(now, c.timezone) > commitmentEndDate(c.startDate, c.weeks) ? "completed" : "active";
}

/**
 * Kept vs. missed for one commitment. `prickles` should include every same-type prickle around
 * the window (see commitmentsFetchWindow); `attendedPrickleIds` is the member's distinct attended
 * prickle ids -- a week counts once no matter how many join/leave rows it has. Occurrences
 * after a cancellation are dropped (not counted as missed).
 */
export function computeCommitmentProgress(
  c: Commitment,
  prickles: SlotPrickle[],
  attendedPrickleIds: ReadonlySet<string>,
  now: Date
): CommitmentProgress {
  const nowMs = now.getTime();
  const cancelledMs = c.cancelledAt ? new Date(c.cancelledAt).getTime() : null;
  const graceMs = ATTENDANCE_GRACE_HOURS * 60 * 60 * 1000;
  const toleranceMs = MATCH_TOLERANCE_MINUTES * 60 * 1000;

  const occurrences: CommitmentOccurrence[] = [];
  for (const date of commitmentOccurrenceDates(c)) {
    const expected = expectedOccurrenceStart(date, c);
    const match = matchOccurrencePrickle(expected, c.typeId, prickles);
    const startMs = match ? new Date(match.startTime).getTime() : expected.getTime();
    if (cancelledMs !== null && startMs > cancelledMs) continue;

    let status: OccurrenceStatus;
    if (match && attendedPrickleIds.has(match.id)) {
      status = "kept";
    } else if (match) {
      if (startMs > nowMs) status = "upcoming";
      else if (new Date(match.endTime).getTime() + graceMs > nowMs) status = "pending";
      else status = "missed";
    } else {
      // No prickle found: still upcoming until the latest time a drifted occurrence could start.
      status = expected.getTime() + toleranceMs > nowMs ? "upcoming" : "no_session";
    }
    occurrences.push({ date, expectedStart: expected.toISOString(), prickleId: match?.id ?? null, status });
  }

  const count = (s: OccurrenceStatus) => occurrences.filter((o) => o.status === s).length;
  return {
    occurrences,
    kept: count("kept"),
    missed: count("missed"),
    pending: count("pending"),
    upcoming: count("upcoming"),
    noSession: count("no_session"),
    effectiveStatus: effectiveCommitmentStatus(c, now),
  };
}

/** UTC range covering every occurrence (plus tolerance) of these commitments -- the prickles query range. */
export function commitmentsFetchWindow(commitments: Commitment[]): { from: string; to: string } | null {
  if (commitments.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const c of commitments) {
    const dates = commitmentOccurrenceDates(c);
    min = Math.min(min, expectedOccurrenceStart(dates[0], c).getTime());
    max = Math.max(max, expectedOccurrenceStart(dates[dates.length - 1], c).getTime());
  }
  const toleranceMs = MATCH_TOLERANCE_MINUTES * 60 * 1000;
  return { from: new Date(min - toleranceMs).toISOString(), to: new Date(max + toleranceMs).toISOString() };
}

/** e.g. "Progress Prickle · every Monday · 7:00 AM EDT" */
export function formatCommitmentLabel(typeName: string, slot: CommitmentSlot): string {
  return formatScheduleLabel(typeName, {
    recurrenceType: "weekly",
    dayOfWeek: slot.dayOfWeek,
    recurrenceAnchorDate: null,
    weekOfMonth: null,
    eventDate: null,
    startTimeLocal: slot.startTimeLocal,
    timezone: slot.timezone,
  });
}

export interface CommitmentInput {
  typeId: string;
  dayOfWeek: number;
  startTimeLocal: string;
  timezone: string;
  startDate: string;
  weeks: number;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shape/range validation for a new commitment, before any DB call. "Today" is the member's local
 * date in input.timezone, and the first occurrence must still be ahead of `now` (committing to a
 * session that already started today would start the commitment with a miss). Whether the slot
 * actually exists on the schedule is checked separately by the server action against real prickles.
 */
export function validateCommitmentInput(input: Partial<CommitmentInput>, now: Date): string | null {
  if (!input.typeId) return "Pick a prickle to commit to";
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek! < 0 || input.dayOfWeek! > 6)
    return "Day of week must be between 0 and 6";
  if (!input.startTimeLocal || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.startTimeLocal))
    return "Start time must be HH:MM";
  if (!input.timezone || !isValidTimeZone(input.timezone)) return "Unknown timezone";
  const today = localDateFor(now, input.timezone);
  if (!input.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || Number.isNaN(Date.parse(input.startDate)))
    return "Start date must be a valid date";
  if (input.startDate < today) return "Start date can't be in the past";
  if (input.startDate > addDays(today, MAX_START_DAYS_AHEAD))
    return `Start date must be within the next ${MAX_START_DAYS_AHEAD} days`;
  if (!Number.isInteger(input.weeks) || input.weeks! < MIN_COMMITMENT_WEEKS || input.weeks! > MAX_COMMITMENT_WEEKS)
    return `Choose between ${MIN_COMMITMENT_WEEKS} and ${MAX_COMMITMENT_WEEKS} weeks`;
  const first = firstOccurrenceDate(input.startDate, input.dayOfWeek!);
  if (expectedOccurrenceStart(first, input as CommitmentSlot).getTime() <= now.getTime())
    return "This week's session has already started -- start from next week instead";
  return null;
}

export interface CommitmentSlotOption extends CommitmentSlot {
  /** The schedule row's seriesKey -- stable within one viewer timezone, used for ?slot= deep links. */
  key: string;
  typeName: string;
  label: string;
  /** Local date of the slot's next occurrence -- the natural default start date. */
  nextDate: string;
}

/**
 * The slots a member can commit to: exactly the recurring rows on the All Prickles schedule
 * (getPrickleScheduleOverview), so a commitment can only target a slot that actually exists.
 */
export function buildSlotOptions(
  rows: {
    seriesKey: string;
    typeId: string | null;
    typeName: string;
    dayOfWeek: string;
    timeLabel: string;
    hostName: string | null;
    nextOccurrenceStart: string;
  }[],
  timeZone: string
): CommitmentSlotOption[] {
  const options: CommitmentSlotOption[] = [];
  for (const row of rows) {
    const slot = slotFromScheduleRow(row, timeZone);
    if (!slot) continue;
    options.push({
      ...slot,
      key: row.seriesKey,
      typeName: row.typeName,
      label: `${row.dayOfWeek} ${row.timeLabel} · ${row.typeName}${row.hostName ? ` with ${row.hostName}` : ""}`,
      nextDate: localDateFor(new Date(row.nextOccurrenceStart), timeZone),
    });
  }
  return options;
}
