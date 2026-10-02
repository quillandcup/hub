// Commitments: a member's promise to attend one or more recurring prickle slots for N weeks
// (e.g. "M/W/F 5am for 4 weeks"). See docs/COMMITMENTS.md and the prickle_commitments /
// prickle_commitment_slots migrations. This module is pure and DB-free -- window/occurrence
// math, slot matching, kept/missed progress, and input validation -- so it's easy to unit test
// (tests/lib/commitments.test.ts). The server actions in
// app/(member)/my-prickles/commitment-actions.ts do the fetching.

import { formatScheduleLabel, zonedTimeToUtc } from "@/lib/prickle-schedules";
import { ORG_TIMEZONE } from "@/lib/config";

export type CommitmentStatus = "active" | "completed" | "cancelled";

/**
 * The timezone the prickle schedule is kept in: prickles repeat at a fixed wall-clock time here,
 * across DST (prickle_schedules.timezone defaults to it too). Recurring slots -- commitment slots
 * and "every week" calendar items -- are stored in this timezone, not the member's own. A slot
 * stored as, say, Europe/London would sit an hour off the schedule for the weeks when US and UK
 * daylight saving start or end on different dates. Labels are still shown in the member's
 * timezone (slotInTimeZone).
 */
export const SCHEDULE_TIMEZONE = ORG_TIMEZONE;

export const MIN_COMMITMENT_WEEKS = 1;
export const MAX_COMMITMENT_WEEKS = 12;
export const DEFAULT_COMMITMENT_WEEKS = 4;
/** Upper bound on slots in one commitment -- two a day, every day, is already a lot. */
export const MAX_COMMITMENT_SLOTS = 14;
/** How far ahead a commitment may start -- enough to plan next month, not a far-future placeholder. */
export const MAX_START_DAYS_AHEAD = 60;

/**
 * How far a prickle's start may drift from the committed wall-clock time and still count as
 * that week's occurrence -- e.g. a one-off time change. (It also absorbed the DST gap for slots
 * stored in a member's own timezone, before slots moved to SCHEDULE_TIMEZONE.) Matching is one-to-one and closest-first (see
 * assignOccurrencePrickles), so an adjacent-hour slot of the same type only matches when the
 * committed one didn't happen -- and two slots of one commitment never claim the same prickle.
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
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A recurring slot, identified the same way as prickle_schedules (type + weekday + local time + timezone). */
export interface CommitmentSlot {
  typeId: string;
  dayOfWeek: number; // 0=Sunday..6=Saturday
  startTimeLocal: string; // "HH:MM" or "HH:MM:SS"
  timezone: string;
}

export interface Commitment {
  id: string;
  startDate: string; // ISO date, local to the slots' timezone
  weeks: number;
  status: CommitmentStatus;
  cancelledAt: string | null;
  slots: CommitmentSlot[];
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
  /** Index into the commitment's `slots`. */
  slotIndex: number;
  /** 1-based week of the commitment this occurrence falls in. */
  week: number;
  date: string; // local ISO date in the slot's timezone
  expectedStart: string; // UTC ISO instant of the committed wall-clock time that date
  prickleId: string | null;
  status: OccurrenceStatus;
}

export interface ProgressCounts {
  kept: number;
  missed: number;
  pending: number;
  upcoming: number;
  noSession: number;
}

export interface CommitmentProgress extends ProgressCounts {
  /** Every occurrence across all slots, in chronological order. */
  occurrences: CommitmentOccurrence[];
  /** Same counts per slot, indexed like the commitment's `slots`. */
  perSlot: ProgressCounts[];
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

/** Identity of a slot, for de-duplication and overlap checks (mirrors the DB's slot columns). */
export function slotKey(slot: CommitmentSlot): string {
  return `${slot.typeId}|${slot.dayOfWeek}|${normalizeTime(slot.startTimeLocal)}|${slot.timezone}`;
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

/** The `weeks` local calendar dates one slot covers, one per week of the window. */
export function slotOccurrenceDates(startDate: string, dayOfWeek: number, weeks: number): string[] {
  const first = firstOccurrenceDate(startDate, dayOfWeek);
  return Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
}

/** The committed wall-clock time on `date`, as a UTC instant (DST-aware for the slot's timezone). */
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

/**
 * The same slot expressed in another timezone, for display: the weekday and time its occurrence
 * on/after `onDate` (a local date in the slot's timezone; defaults to today there) falls on in
 * `timeZone`. Across a DST boundary the result can differ week to week, so never store it.
 */
export function slotInTimeZone(slot: CommitmentSlot, timeZone: string, now: Date = new Date()): CommitmentSlot {
  if (slot.timezone === timeZone) return slot;
  const date = firstOccurrenceDate(localDateFor(now, slot.timezone), slot.dayOfWeek);
  const instant = expectedOccurrenceStart(date, slot);
  return { typeId: slot.typeId, ...slotTimeForInstant(instant.toISOString(), timeZone), timezone: timeZone };
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

/**
 * One-to-one assignment of prickles to expected occurrences: every (occurrence, same-type
 * prickle within tolerance) pair, closest first, each side used at most once. Returns the
 * matched prickle per occurrence index (null when none ran).
 */
export function assignOccurrencePrickles(
  expected: { typeId: string; start: Date }[],
  prickles: SlotPrickle[],
  toleranceMinutes: number = MATCH_TOLERANCE_MINUTES
): (SlotPrickle | null)[] {
  const toleranceMs = toleranceMinutes * 60 * 1000;
  const pairs: { occ: number; prickle: SlotPrickle; delta: number }[] = [];
  expected.forEach((e, occ) => {
    for (const p of prickles) {
      if (p.typeId !== e.typeId) continue;
      const delta = Math.abs(new Date(p.startTime).getTime() - e.start.getTime());
      if (delta <= toleranceMs) pairs.push({ occ, prickle: p, delta });
    }
  });
  pairs.sort((a, b) => a.delta - b.delta || a.occ - b.occ);

  const result: (SlotPrickle | null)[] = expected.map(() => null);
  const used = new Set<string>();
  for (const { occ, prickle } of pairs) {
    if (result[occ] || used.has(prickle.id)) continue;
    result[occ] = prickle;
    used.add(prickle.id);
  }
  return result;
}

/**
 * Distinct attended prickle ids from raw prickle_attendance rows. A member can leave and rejoin
 * (multiple rows per prickle, see CLAUDE.md), but an occurrence is kept once no matter how many rows.
 */
export function buildAttendedSet(rows: { prickle_id: string }[]): Set<string> {
  return new Set(rows.map((r) => r.prickle_id));
}

/**
 * Stored status, except an 'active' commitment whose last day has passed (in every slot's
 * timezone -- in practice they share one) reads as 'completed'.
 */
export function effectiveCommitmentStatus(
  c: Pick<Commitment, "status" | "startDate" | "weeks" | "slots">,
  now: Date
): CommitmentStatus {
  if (c.status !== "active") return c.status;
  const endDate = commitmentEndDate(c.startDate, c.weeks);
  const zones = c.slots.length > 0 ? [...new Set(c.slots.map((s) => s.timezone))] : ["UTC"];
  return zones.every((tz) => localDateFor(now, tz) > endDate) ? "completed" : "active";
}

function emptyCounts(): ProgressCounts {
  return { kept: 0, missed: 0, pending: 0, upcoming: 0, noSession: 0 };
}

const COUNT_KEY: Record<OccurrenceStatus, keyof ProgressCounts> = {
  kept: "kept",
  missed: "missed",
  pending: "pending",
  upcoming: "upcoming",
  no_session: "noSession",
};

/**
 * Kept vs. missed for one commitment, per occurrence across all its slots. `prickles` should
 * include every same-type prickle around the window (see commitmentsFetchWindow);
 * `attendedPrickleIds` is the member's distinct attended prickle ids -- an occurrence counts once
 * no matter how many join/leave rows it has. Occurrences after a cancellation are dropped (not
 * counted as missed).
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

  const planned: { slotIndex: number; week: number; date: string; start: Date; typeId: string }[] = [];
  c.slots.forEach((slot, slotIndex) => {
    slotOccurrenceDates(c.startDate, slot.dayOfWeek, c.weeks).forEach((date, i) => {
      planned.push({ slotIndex, week: i + 1, date, start: expectedOccurrenceStart(date, slot), typeId: slot.typeId });
    });
  });
  const matches = assignOccurrencePrickles(planned, prickles);

  const occurrences: CommitmentOccurrence[] = [];
  planned.forEach((p, i) => {
    const match = matches[i];
    const startMs = match ? new Date(match.startTime).getTime() : p.start.getTime();
    if (cancelledMs !== null && startMs > cancelledMs) return;

    let status: OccurrenceStatus;
    if (match && attendedPrickleIds.has(match.id)) {
      status = "kept";
    } else if (match) {
      if (startMs > nowMs) status = "upcoming";
      else if (new Date(match.endTime).getTime() + graceMs > nowMs) status = "pending";
      else status = "missed";
    } else {
      // No prickle found: still upcoming until the latest time a drifted occurrence could start.
      status = p.start.getTime() + toleranceMs > nowMs ? "upcoming" : "no_session";
    }
    occurrences.push({
      slotIndex: p.slotIndex,
      week: p.week,
      date: p.date,
      expectedStart: p.start.toISOString(),
      prickleId: match?.id ?? null,
      status,
    });
  });
  occurrences.sort((a, b) => a.expectedStart.localeCompare(b.expectedStart) || a.slotIndex - b.slotIndex);

  const totals = emptyCounts();
  const perSlot = c.slots.map(() => emptyCounts());
  for (const o of occurrences) {
    totals[COUNT_KEY[o.status]]++;
    perSlot[o.slotIndex][COUNT_KEY[o.status]]++;
  }

  return { occurrences, ...totals, perSlot, effectiveStatus: effectiveCommitmentStatus(c, now) };
}

/** UTC range covering every occurrence (plus tolerance) of these commitments -- the prickles query range. */
export function commitmentsFetchWindow(commitments: Commitment[]): { from: string; to: string } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const c of commitments) {
    for (const slot of c.slots) {
      const dates = slotOccurrenceDates(c.startDate, slot.dayOfWeek, c.weeks);
      min = Math.min(min, expectedOccurrenceStart(dates[0], slot).getTime());
      max = Math.max(max, expectedOccurrenceStart(dates[dates.length - 1], slot).getTime());
    }
  }
  if (!Number.isFinite(min)) return null;
  const toleranceMs = MATCH_TOLERANCE_MINUTES * 60 * 1000;
  return { from: new Date(min - toleranceMs).toISOString(), to: new Date(max + toleranceMs).toISOString() };
}

/** e.g. "Progress Prickle · every Monday · 7:00 AM EDT" */
export function formatSlotLabel(typeName: string, slot: CommitmentSlot): string {
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

/**
 * A one-line title for a commitment. Slots sharing a type and time collapse into one day list
 * ("Progress Prickle · Mon, Wed, Fri · 5 AM EDT"); otherwise one "Type · Day · time" part per slot.
 */
export function formatCommitmentTitle(slots: (CommitmentSlot & { typeName: string })[]): string {
  if (slots.length === 1) return formatSlotLabel(slots[0].typeName, slots[0]);
  const groups = new Map<string, (CommitmentSlot & { typeName: string })[]>();
  for (const s of slots) {
    const key = `${s.typeId}|${normalizeTime(s.startTimeLocal)}|${s.timezone}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()]
    .map((group) => {
      const days = [...group].sort((a, b) => a.dayOfWeek - b.dayOfWeek).map((s) => DAY_SHORT[s.dayOfWeek]);
      // Reuse the single-slot label's time part (after the last " · ").
      const time = formatSlotLabel(group[0].typeName, group[0]).split(" · ").pop();
      return `${group[0].typeName} · ${days.join(", ")} · ${time}`;
    })
    .join("; ");
}

export interface CommitmentInput {
  slots: CommitmentSlot[];
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

function validateSlot(slot: Partial<CommitmentSlot>): string | null {
  if (!slot.typeId) return "Pick a prickle to commit to";
  if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek! < 0 || slot.dayOfWeek! > 6)
    return "Day of week must be between 0 and 6";
  if (!slot.startTimeLocal || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(slot.startTimeLocal))
    return "Start time must be HH:MM";
  if (!slot.timezone || !isValidTimeZone(slot.timezone)) return "Unknown timezone";
  return null;
}

/**
 * Shape/range validation for a new commitment, before any DB call. "Today" is the member's local
 * date in the slots' timezone (all slots must share one), and every slot's first occurrence must
 * still be ahead of `now` (committing to a session that already started would open the commitment
 * with a miss). Whether each slot actually exists on the schedule is checked separately by the
 * server action against real prickles.
 */
export function validateCommitmentInput(input: Partial<CommitmentInput>, now: Date): string | null {
  const slots = input.slots ?? [];
  if (slots.length === 0) return "Pick at least one prickle to commit to";
  if (slots.length > MAX_COMMITMENT_SLOTS) return `Pick at most ${MAX_COMMITMENT_SLOTS} prickles per commitment`;
  for (const slot of slots) {
    const error = validateSlot(slot);
    if (error) return error;
  }
  if (new Set(slots.map(slotKey)).size !== slots.length) return "The same prickle is picked twice";
  const timezone = slots[0].timezone;
  if (slots.some((s) => s.timezone !== timezone)) return "All prickles in a commitment must use the same timezone";
  if (timezone !== SCHEDULE_TIMEZONE) return "Pick prickles from All Prickles";

  const today = localDateFor(now, timezone);
  if (!input.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || Number.isNaN(Date.parse(input.startDate)))
    return "Start date must be a valid date";
  if (input.startDate < today) return "Start date can't be in the past";
  if (input.startDate > addDays(today, MAX_START_DAYS_AHEAD))
    return `Start date must be within the next ${MAX_START_DAYS_AHEAD} days`;
  if (!Number.isInteger(input.weeks) || input.weeks! < MIN_COMMITMENT_WEEKS || input.weeks! > MAX_COMMITMENT_WEEKS)
    return `Choose between ${MIN_COMMITMENT_WEEKS} and ${MAX_COMMITMENT_WEEKS} weeks`;
  for (const slot of slots) {
    const first = firstOccurrenceDate(input.startDate, slot.dayOfWeek);
    if (expectedOccurrenceStart(first, slot).getTime() <= now.getTime())
      return "One of these prickles has already started this week -- start from a later date";
  }
  return null;
}

/**
 * The earliest start date for which every slot's first occurrence is still ahead of `now`:
 * today (local) unless a picked slot's session today has already started, then tomorrow, etc.
 */
export function defaultCommitmentStartDate(slots: CommitmentSlot[], now: Date): string {
  const timezone = slots[0]?.timezone ?? "UTC";
  let date = localDateFor(now, timezone);
  for (let i = 0; i < 7; i++) {
    const ok = slots.every(
      (s) => expectedOccurrenceStart(firstOccurrenceDate(date, s.dayOfWeek), s).getTime() > now.getTime()
    );
    if (ok) return date;
    date = addDays(date, 1);
  }
  return date;
}

/** Whether two commitments' date windows overlap (both inclusive). */
export function windowsOverlap(
  a: Pick<Commitment, "startDate" | "weeks">,
  b: Pick<Commitment, "startDate" | "weeks">
): boolean {
  return a.startDate <= commitmentEndDate(b.startDate, b.weeks) && b.startDate <= commitmentEndDate(a.startDate, a.weeks);
}

/**
 * Mirrors the DB's overlap rule (check_prickle_commitment_slot_overlap) so the server action can
 * return a friendly message: the first existing active commitment that shares a slot with the new
 * one and whose window overlaps, or null.
 */
export function findOverlappingCommitment(
  input: Pick<Commitment, "startDate" | "weeks" | "slots">,
  existing: Commitment[],
  now: Date
): Commitment | null {
  const keys = new Set(input.slots.map(slotKey));
  for (const c of existing) {
    if (effectiveCommitmentStatus(c, now) !== "active") continue;
    if (!windowsOverlap(input, c)) continue;
    if (c.slots.some((s) => keys.has(slotKey(s)))) return c;
  }
  return null;
}

export interface CommitmentSlotOption extends CommitmentSlot {
  /** The schedule row's seriesKey -- stable within one viewer timezone, used for ?commit= deep links. */
  key: string;
  typeName: string;
  label: string;
  /** Date of the slot's next occurrence, local to the slot's timezone (SCHEDULE_TIMEZONE). */
  nextDate: string;
}

/**
 * The slots a member can commit to: exactly the recurring rows on the All Prickles schedule
 * (getPrickleScheduleOverview), so a commitment can only target a slot that actually exists.
 * Slots are in SCHEDULE_TIMEZONE; the label keeps the row's own (viewer-timezone) day and time.
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
  }[]
): CommitmentSlotOption[] {
  const options: CommitmentSlotOption[] = [];
  for (const row of rows) {
    const slot = slotFromScheduleRow(row, SCHEDULE_TIMEZONE);
    if (!slot) continue;
    options.push({
      ...slot,
      key: row.seriesKey,
      typeName: row.typeName,
      label: `${row.dayOfWeek} ${row.timeLabel} · ${row.typeName}${row.hostName ? ` with ${row.hostName}` : ""}`,
      nextDate: localDateFor(new Date(row.nextOccurrenceStart), SCHEDULE_TIMEZONE),
    });
  }
  return options;
}
