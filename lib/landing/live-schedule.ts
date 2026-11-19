import { ORG_TIMEZONE } from "@/lib/config";
import type { Repos } from "@/lib/data/repos";
import { cleanEventTitle } from "@/lib/events-agenda";
import { loadLiveRoom } from "@/lib/live-room";
import { easternDay } from "./live-stats";

/**
 * The public schedule behind the Schedule panel and the Announcement strip (docs/LANDING_PAGES.md, "Live data").
 *
 * Which prickles may appear: every upcoming one, the same set the members' Upcoming list ranks (`activeBetween`: running or
 * starting in the window, the Event type's schedules left out by the repository), whatever its type; the one rule here is
 * that it has not ended. `prickle_types.announced_publicly` means "worth listing as an event" and plays no part. A flag
 * to narrow this to drop-in sessions is planned (docs/TODO.md, "Landing pages: finish and publish the new homepage").
 *
 * What may appear: a cleaned title, the start and end, and two facts that identify nobody: whether the host has hosted
 * `EXPERIENCED_HOST_PRICKLES` or more past prickles, and, while one is running, how many people are in the room.
 * No names, no ids of people, no join link, never a count of who is coming.
 */

/** A host with this many past prickles is "an experienced host". About half of past prickles have no host recorded, so a count is a floor. */
export const EXPERIENCED_HOST_PRICKLES = 100;
/** "Writing now" shows only with this many people in the room: one or none is not a number worth saying. */
export const MIN_WRITING_NOW = 2;
/** How far ahead the snapshot looks (so a block can ask for up to this many hours) and how many prickles it keeps. */
export const MAX_HOURS_AHEAD = 144;
const SNAPSHOT_LIMIT = 12;
/** A prickle starting within this long is "soon". */
const SOON_MINUTES = 60;
/** The strip speaks about the next prickle only when it is this close. */
export const STRIP_HOURS_AHEAD = 24;

const MINUTE = 60_000;
const HOUR = 3_600_000;

export type PublicPrickle = { id: string; title: string; startTime: string; endTime: string; experiencedHost: boolean };
/** What is cached for a minute and handed to every visitor: nothing here is about a person. */
export type ScheduleSnapshot = { prickles: PublicPrickle[]; writingNow: { prickleId: string; count: number } | null };

type ScheduleRepos = Pick<Repos, "aliases" | "members" | "prickles" | "zoom">;

/** A prickle's name for the public: the cleaned title, with a calendar's "w/ Name" host marker taken off (no host names on this page). */
export function publicTitle(title: string | null | undefined, typeName: string | null | undefined): string {
  const raw = (title ?? "").trim() || (typeName ?? "").trim();
  return cleanEventTitle(raw).replace(/\s+w\/.*$/i, "").trim() || "Prickle";
}

/** Upcoming prickles from now to `MAX_HOURS_AHEAD` ahead (running ones included), with the room count when one is running. Throws on a read failure; the caller falls back to typed values. */
export async function loadScheduleSnapshot(repos: ScheduleRepos, nowDate: Date): Promise<ScheduleSnapshot> {
  const now = nowDate.getTime();
  const nowIso = nowDate.toISOString();
  const found = await repos.prickles.activeBetween({ from: nowIso, to: new Date(now + MAX_HOURS_AHEAD * HOUR).toISOString() });
  const open = found
    .filter((p) => Date.parse(p.endTime) > now)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id))
    .slice(0, SNAPSHOT_LIMIT);
  const running = open.find((p) => Date.parse(p.startTime) <= now);
  const hostIds = [...new Set(open.flatMap((p) => (p.hostId ? [p.hostId] : [])))];
  const [counts, room] = await Promise.all([
    Promise.all(hostIds.map(async (id) => [id, await repos.prickles.countHostedBy(id, { before: nowIso })] as const)),
    running ? loadLiveRoom(repos, nowDate) : Promise.resolve(null),
  ]);
  const hosted = new Map(counts);
  return {
    prickles: open.map((p) => ({
      id: p.id,
      title: publicTitle(p.title, p.type?.name),
      startTime: p.startTime,
      endTime: p.endTime,
      experiencedHost: p.hostId ? (hosted.get(p.hostId) ?? 0) >= EXPERIENCED_HOST_PRICKLES : false,
    })),
    // The room's count (members who hid from Who's coming and guests included); the names it also holds go no further than this line.
    writingNow: room?.live && room.prickle && running && room.prickle.id === running.id ? { prickleId: running.id, count: room.count } : null,
  };
}

// ---- Turning a snapshot into what a block shows (pure, against the real "now") ------------------------------------

const clock = (instant: number) => new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(instant)).replace(/\s?(AM|PM)$/i, (_, p: string) => ` ${p.toLowerCase()}`);
const weekday = (instant: number) => new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, weekday: "short" }).format(new Date(instant));

/** "ET": the organization's zone by its short generic name. */
export function zoneNote(instant: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, timeZoneName: "shortGeneric" }).formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? "";
}

export type HostStyle = "none" | "experience";
export type LiveScheduleRow = { time: string; title: string; status: string; state: "live" | "soon" | "open"; host: string };

export const DEFAULT_EXPERIENCED_HOST_TEXT = "An experienced host, sure to make you feel at home";
export type ScheduleOptions = { hoursAhead: number; maxRows: number; hostStyle: HostStyle; experiencedHostText: string };

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const scheduleOptions = (props: { hoursAhead?: unknown; maxRows?: unknown; hostStyle?: unknown; experiencedHostText?: unknown }): ScheduleOptions => ({
  hoursAhead: clampInt(props.hoursAhead, 1, MAX_HOURS_AHEAD, 24),
  maxRows: clampInt(props.maxRows, 1, 6, 5),
  hostStyle: props.hostStyle === "experience" ? "experience" : "none",
  experiencedHostText: typeof props.experiencedHostText === "string" && props.experiencedHostText.trim() ? props.experiencedHostText.trim().slice(0, 140) : DEFAULT_EXPERIENCED_HOST_TEXT,
});

/** The rows the panel shows now: running or starting within the window, soonest first. */
export function scheduleRows(snapshot: ScheduleSnapshot, nowDate: Date, options: ScheduleOptions): LiveScheduleRow[] {
  const now = nowDate.getTime();
  const today = easternDay(now, 0);
  return snapshot.prickles
    .filter((p) => Date.parse(p.endTime) > now && Date.parse(p.startTime) < now + options.hoursAhead * HOUR)
    .slice(0, options.maxRows)
    .map((p) => {
      const start = Date.parse(p.startTime);
      const running = start <= now;
      const minutes = Math.ceil((start - now) / MINUTE);
      const soon = !running && minutes <= SOON_MINUTES;
      const room = snapshot.writingNow?.prickleId === p.id ? snapshot.writingNow.count : 0;
      const sameDay = easternDay(start, 0) === today;
      return {
        time: sameDay || running ? clock(start) : `${weekday(start)} ${clock(start)}`,
        title: p.title,
        status: running ? (room >= MIN_WRITING_NOW ? `${room} writing now` : "Live") : soon ? `In ${minutes} min` : "",
        state: running ? "live" : soon ? "soon" : "open",
        host: options.hostStyle === "experience" && p.experiencedHost ? options.experiencedHostText : "",
      };
    });
}

/** The strip's line: a prickle is on, or the next public one starts within a day; "" when none does. */
export function stripText(snapshot: ScheduleSnapshot, nowDate: Date): string {
  const now = nowDate.getTime();
  const upcoming = snapshot.prickles.filter((p) => Date.parse(p.endTime) > now && Date.parse(p.startTime) < now + STRIP_HOURS_AHEAD * HOUR);
  if (upcoming.some((p) => Date.parse(p.startTime) <= now)) return "A prickle is on now";
  const next = upcoming[0];
  if (!next) return "";
  const start = Date.parse(next.startTime);
  const minutes = Math.ceil((start - now) / MINUTE);
  if (minutes < 60) return `Your next prickle starts in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const day = easternDay(start, 0) === easternDay(now, 0) ? "today" : "tomorrow";
  return `Your next prickle starts ${day} at ${clock(start)} ${zoneNote(start)}`.trim();
}
