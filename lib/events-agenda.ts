// The "Upcoming" month-at-a-glance on the member Events page (app/(member)/events): everything coming up in
// one of the next three months as a dated list, a week at a time. Events and the featured prickles that have no
// event yet go in the same list. Pure functions over YYYY-MM-DD dates and instants, so they can be tested without a clock.

import { ORG_TIMEZONE } from "@/lib/config";

/** How many months the page offers: this one and the next two. */
export const AGENDA_MONTHS = 3;

export interface AgendaMonth {
  /** YYYY-MM, which is also what `?month=` carries. */
  id: string;
  /** "October". */
  label: string;
  /** First and last day of the month (YYYY-MM-DD). */
  first: string;
  last: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** This month and the next ones, from `today` (YYYY-MM-DD, the viewer's date). */
export function agendaMonths(today: string): AgendaMonth[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: AGENDA_MONTHS }, (_, i) => {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(y, m + i, 0));
    return {
      id: `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}`,
      label: first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }),
      first: ymd(first),
      last: ymd(last),
    };
  });
}

/** The month a `?month=` value names, else the first one. */
export function parseAgendaMonth(raw: string | string[] | undefined | null, months: readonly AgendaMonth[]): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return months.find((m) => m.id === value)?.id ?? months[0].id;
}

/** The Sunday on or before a date (weeks start on Sunday). */
export function weekStart(date: string): string {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return ymd(d);
}

/** YYYY-MM-DD of an instant in a zone. */
export function dateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Whether an event's times mean "all day": it starts and ends at midnight in the organization's zone (how a calendar writes one). */
export function isAllDay(startIso: string, endIso: string): boolean {
  const atMidnight = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) === "00:00";
  return atMidnight(startIso) && atMidnight(endIso);
}

function clock(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minute = get("minute");
  return { hour: get("hour"), minute: minute === "00" ? "" : `:${minute}`, period: get("dayPeriod").toLowerCase() };
}

/**
 * "2 pm ET", "2 – 3 pm ET", "11:30 am – 1 pm ET": the time of day in the viewer's zone, the way the monthly flyer
 * writes it. A span over several days gives its start only. Empty when there is nothing to say (no times, or all day).
 */
export function formatTimeSpan(startIso: string | null | undefined, endIso: string | null | undefined, timeZone: string): string {
  if (!startIso) return "";
  if (endIso && isAllDay(startIso, endIso)) return "";
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(startIso)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const start = clock(startIso, timeZone);
  const sameDay = !!endIso && dateIn(startIso, timeZone) === dateIn(endIso, timeZone);
  const text = sameDay
    ? (() => {
        const end = clock(endIso!, timeZone);
        const from = start.period === end.period ? `${start.hour}${start.minute}` : `${start.hour}${start.minute} ${start.period}`;
        return `${from} – ${end.hour}${end.minute} ${end.period}`;
      })()
    : `${start.hour}${start.minute} ${start.period}`;
  return zone ? `${text} ${zone}` : text;
}

/** "Quill & Cup [Category] Prickle: Title" -> "Title". The organization's label, the "[Category]" and a "Prickle:" label are not part of the name. */
export function cleanEventTitle(title: string): string {
  const cleaned = title
    .replace(/^\s*(?:quill\s*&\s*cup|q\s*&\s*c)\s*(?:prickle\s*)?(?=[[:])/i, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .replace(/^\s*prickle\s*:\s*/i, "")
    .replace(/^\s*:\s*/, "")
    .trim();
  return cleaned || title.trim();
}

/** One line of the agenda: an event or a featured prickle. */
export interface AgendaItem {
  key: string;
  href: string;
  title: string;
  /** First and last day it falls on (YYYY-MM-DD, the viewer's zone). */
  startDate: string;
  endDate: string;
  /** What the viewer reads: "2 pm ET", or "" for an all-day or untimed event. */
  time: string;
  /** Where it is when that is a place (an online event is the default, so it says nothing); null otherwise. */
  place: string | null;
  /** The instant it starts, for the secondary time zone note; null without a time. */
  startsAt: string | null;
  track: string;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : -1);

export interface AgendaWeek {
  /** The Sunday that starts it. */
  start: string;
  days: { date: string; items: AgendaItem[] }[];
}

/**
 * The items that fall in a month and haven't ended before `today`, by day, in weeks. An item that runs across
 * several days sits on its first day in the month (a retreat that began last month sits on the 1st), soonest first.
 */
export function agendaWeeks(items: readonly AgendaItem[], month: AgendaMonth, today: string): AgendaWeek[] {
  const placed = items
    .filter((i) => i.endDate >= today && i.endDate >= month.first && i.startDate <= month.last)
    .map((i) => ({ item: i, day: [i.startDate, month.first, today].reduce((a, b) => (a > b ? a : b)) }))
    .sort((a, b) => a.day.localeCompare(b.day) || ms(a.item.startsAt) - ms(b.item.startsAt) || a.item.title.localeCompare(b.item.title));

  const weeks: AgendaWeek[] = [];
  for (const { item, day } of placed) {
    const start = weekStart(day);
    let week = weeks[weeks.length - 1];
    if (!week || week.start !== start) weeks.push((week = { start, days: [] }));
    let slot = week.days[week.days.length - 1];
    if (!slot || slot.date !== day) week.days.push((slot = { date: day, items: [] }));
    slot.items.push(item);
  }
  return weeks;
}
