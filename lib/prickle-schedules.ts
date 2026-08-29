// Logic for the Hosting feature (member self-service at /hosting, admin
// review at /admin/hosts). Most of this module is pure and DB-free -- month
// boundaries, lock state, human labels, and which calendar dates a schedule
// lands on -- so it's easy to unit test in isolation (see
// tests/lib/prickle-schedules.test.ts). seedNextMonthSchedules at the bottom
// is the one function that touches the database.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RecurrenceType = "weekly" | "biweekly" | "monthly" | "one_off";
export type ScheduleStatus = "proposed" | "confirmed" | "declined";

export interface PrickleSchedule {
  recurrenceType: RecurrenceType;
  dayOfWeek: number | null; // 0=Sunday..6=Saturday
  recurrenceAnchorDate: string | null; // ISO date, biweekly only
  weekOfMonth: number | null; // 1..5, monthly only
  eventDate: string | null; // ISO date, one_off only
  startTimeLocal: string; // "HH:MM" or "HH:MM:SS"
  timezone: string;
}

export interface LockOverride {
  month: string; // ISO date, first-of-month
  locked: boolean;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th"];

function toUtcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** First-of-month (UTC midnight) for the month containing `now`. */
export function getMonthStart(now: Date): Date {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/** Last day (UTC midnight) of the month containing `now`. */
export function getMonthEnd(now: Date): Date {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 0);
}

/** First-of-month (UTC midnight) for the month after the one containing `now`. */
export function getNextMonthStart(now: Date): Date {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Effective lock state for `month`: an explicit override wins; otherwise a
 * month is locked once it has started (month <= the current month) and open
 * while still in the future. Mirrors is_prickle_schedule_month_locked() in
 * the prickle_schedules migration, which is the actual enforcement point
 * (RLS) -- this is only used to show a friendly error before a write attempt
 * reaches Postgres.
 */
export function isMonthLocked(month: Date, overrides: LockOverride[], now: Date): boolean {
  const key = isoDate(month);
  const override = overrides.find((o) => o.month.slice(0, 10) === key);
  if (override) return override.locked;
  return month.getTime() <= getMonthStart(now).getTime();
}

function formatTime(startTimeLocal: string, timezone: string): string {
  const [hourStr, minuteStr] = startTimeLocal.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  // start_time_local is already a wall-clock time in `timezone` -- no
  // conversion needed. Building it as a UTC instant and formatting with
  // timeZone: "UTC" just renders the hour/minute as given, regardless of the
  // browser/server's own local timezone (which Intl would otherwise use by
  // default and silently shift the displayed hour).
  const reference = new Date(Date.UTC(2000, 0, 1, hour, minute));
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(reference);
  const abbrev = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: timezone })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return abbrev ? `${formatted} ${abbrev}` : formatted;
}

/** e.g. "Progress Prickle · every Tuesday · 7:00 PM ET" */
export function formatScheduleLabel(typeName: string, schedule: PrickleSchedule): string {
  const time = formatTime(schedule.startTimeLocal, schedule.timezone);
  switch (schedule.recurrenceType) {
    case "weekly":
      return `${typeName} · every ${DAY_NAMES[schedule.dayOfWeek!]} · ${time}`;
    case "biweekly":
      return `${typeName} · every other ${DAY_NAMES[schedule.dayOfWeek!]} · ${time}`;
    case "monthly":
      return `${typeName} · ${ORDINALS[schedule.weekOfMonth!]} ${DAY_NAMES[schedule.dayOfWeek!]} · ${time}`;
    case "one_off": {
      const d = new Date(`${schedule.eventDate}T00:00:00Z`);
      const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
      return `${typeName} · ${dateLabel} · ${time}`;
    }
  }
}

/**
 * All calendar dates within [monthStart, monthEnd] that `schedule` lands on.
 * weekly = every matching weekday; biweekly = matching weekdays filtered by
 * parity against recurrenceAnchorDate; monthly = the single Nth-weekday date
 * (empty if that occurrence doesn't exist, e.g. a month with no 5th Friday);
 * one_off = the event date itself, if it falls in range.
 */
export function generateScheduleInstanceDates(
  schedule: PrickleSchedule,
  monthStart: Date,
  monthEnd: Date
): Date[] {
  if (schedule.recurrenceType === "one_off") {
    if (!schedule.eventDate) return [];
    const d = new Date(`${schedule.eventDate}T00:00:00Z`);
    return d.getTime() >= monthStart.getTime() && d.getTime() <= monthEnd.getTime() ? [d] : [];
  }

  const dayOfWeek = schedule.dayOfWeek!;
  const dates: Date[] = [];
  for (
    let d = new Date(monthStart);
    d.getTime() <= monthEnd.getTime();
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  ) {
    if (d.getUTCDay() !== dayOfWeek) continue;

    if (schedule.recurrenceType === "weekly") {
      dates.push(new Date(d));
      continue;
    }

    if (schedule.recurrenceType === "biweekly") {
      if (!schedule.recurrenceAnchorDate) continue;
      const anchor = new Date(`${schedule.recurrenceAnchorDate}T00:00:00Z`);
      const weeksSinceAnchor = Math.round((d.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weeksSinceAnchor % 2 === 0) dates.push(new Date(d));
      continue;
    }

    if (schedule.recurrenceType === "monthly") {
      const occurrence = Math.floor((d.getUTCDate() - 1) / 7) + 1;
      if (occurrence === schedule.weekOfMonth) dates.push(new Date(d));
    }
  }
  return dates;
}

/** Stat-row counts for the member/admin month views. */
export function summarizeMonth(schedules: { status: ScheduleStatus }[]): {
  proposed: number;
  confirmed: number;
  declined: number;
} {
  return schedules.reduce(
    (acc, s) => {
      acc[s.status]++;
      return acc;
    },
    { proposed: 0, confirmed: 0, declined: 0 }
  );
}

export interface ScheduleInput {
  typeId: string;
  month: string;
  recurrenceType: RecurrenceType;
  dayOfWeek?: number | null;
  recurrenceAnchorDate?: string | null;
  weekOfMonth?: number | null;
  eventDate?: string | null;
  startTimeLocal: string;
  timezone?: string;
}

/**
 * Mirrors the CHECK constraint on prickle_schedules (see the migration) so
 * both app/api/prickle-schedules and the member actions in
 * app/(member)/hosting/actions.ts can reject a bad combination with a
 * readable message before it ever reaches Postgres.
 */
export function validateScheduleInput(input: Partial<ScheduleInput>): string | null {
  if (!input.typeId) return "type_id is required";
  if (!input.month) return "month is required";
  if (!input.startTimeLocal) return "start_time_local is required";
  if (!input.recurrenceType || !["weekly", "biweekly", "monthly", "one_off"].includes(input.recurrenceType)) {
    return "recurrence_type must be one of: weekly, biweekly, monthly, one_off";
  }

  switch (input.recurrenceType) {
    case "weekly":
      if (input.dayOfWeek == null) return "day_of_week is required for weekly schedules";
      if (input.recurrenceAnchorDate || input.weekOfMonth != null || input.eventDate)
        return "weekly schedules only use day_of_week";
      break;
    case "biweekly":
      if (input.dayOfWeek == null) return "day_of_week is required for biweekly schedules";
      if (!input.recurrenceAnchorDate) return "recurrence_anchor_date is required for biweekly schedules";
      if (input.weekOfMonth != null || input.eventDate)
        return "biweekly schedules only use day_of_week and recurrence_anchor_date";
      break;
    case "monthly":
      if (input.dayOfWeek == null) return "day_of_week is required for monthly schedules";
      if (input.weekOfMonth == null) return "week_of_month is required for monthly schedules";
      if (input.recurrenceAnchorDate || input.eventDate)
        return "monthly schedules only use day_of_week and week_of_month";
      break;
    case "one_off":
      if (!input.eventDate) return "event_date is required for one_off schedules";
      if (input.dayOfWeek != null || input.recurrenceAnchorDate || input.weekOfMonth != null)
        return "one_off schedules only use event_date";
      break;
  }

  if (input.dayOfWeek != null && (input.dayOfWeek < 0 || input.dayOfWeek > 6)) return "day_of_week must be between 0 and 6";
  if (input.weekOfMonth != null && (input.weekOfMonth < 1 || input.weekOfMonth > 5))
    return "week_of_month must be between 1 and 5";

  return null;
}

interface SeedableRow {
  id: string;
  host_id: string;
  type_id: string;
  recurrence_type: RecurrenceType;
  day_of_week: number | null;
  week_of_month: number | null;
  recurrence_anchor_date: string | null;
  start_time_local: string;
  timezone: string;
  notes: string | null;
}

function continuationKey(row: Pick<SeedableRow, "host_id" | "type_id" | "recurrence_type" | "day_of_week" | "week_of_month">): string {
  return [row.host_id, row.type_id, row.recurrence_type, row.day_of_week, row.week_of_month].join("|");
}

/**
 * Continuity by default: copies every `confirmed`, non-deleted, non-`one_off`
 * schedule in `fromMonth` into `toMonth` as a new `proposed` row (unless a
 * row for that host+type+recurrence already exists in `toMonth`), so members
 * don't have to re-declare their recurring slot from scratch every month.
 * Idempotent -- safe to call on every "view next month" request rather than
 * needing a scheduled job. one_off events never carry forward, since they're
 * single-date by definition.
 */
export async function seedNextMonthSchedules(
  supabase: SupabaseClient,
  fromMonth: string,
  toMonth: string
): Promise<number> {
  const [{ data: fromRows }, { data: toRows }] = await Promise.all([
    supabase
      .from("prickle_schedules")
      .select("id, host_id, type_id, recurrence_type, day_of_week, week_of_month, recurrence_anchor_date, start_time_local, timezone, notes")
      .eq("month", fromMonth)
      .eq("status", "confirmed")
      .neq("recurrence_type", "one_off")
      .is("deleted_at", null),
    supabase
      .from("prickle_schedules")
      .select("host_id, type_id, recurrence_type, day_of_week, week_of_month")
      .eq("month", toMonth)
      .is("deleted_at", null),
  ]);

  const existingKeys = new Set((toRows ?? []).map((r) => continuationKey(r)));
  const toInsert = ((fromRows ?? []) as SeedableRow[]).filter((r) => !existingKeys.has(continuationKey(r)));

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from("prickle_schedules").insert(
    toInsert.map((r) => ({
      host_id: r.host_id,
      type_id: r.type_id,
      month: toMonth,
      recurrence_type: r.recurrence_type,
      day_of_week: r.day_of_week,
      week_of_month: r.week_of_month,
      recurrence_anchor_date: r.recurrence_anchor_date,
      start_time_local: r.start_time_local,
      timezone: r.timezone,
      notes: r.notes,
      status: "proposed",
      carried_forward_from: r.id,
    }))
  );

  if (error) throw new Error(error.message);
  return toInsert.length;
}
