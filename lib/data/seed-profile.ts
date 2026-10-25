import type { AttendanceRow } from "./attendance";
import type { BadgeType, MemberBadge } from "./badges";
import { InMemoryDataset } from "./in-memory";
import type { InAppNotificationRow } from "./notifications";
import type { Prickle, PrickleType } from "./prickles";

/**
 * A seed profile: a whole fictional community as typed data, in one file. The same profile feeds a
 * test (as an `InMemoryDataset`, for the repositories and everything that takes them), a demo or help
 * article (the demo stack seeds the same people and rhythm into a real database), and a preview.
 * Everything is relative to "today", so a profile never goes stale: `buildDataset(profile, now)` puts
 * the history behind `now` and the upcoming week ahead of it.
 *
 * Invented names and example.com addresses only (the repo is public).
 */

/** Someone in the community. */
export interface ProfilePerson {
  /** Short handle a scene or test refers to them by ("member", "host"). */
  key: string;
  name: string;
  email: string;
  /** Signs in during a demo (has an account); the others only fill the room. */
  signsIn: boolean;
  role: "admin" | "member";
  /** Days since they joined, or null for staff who have no member record. */
  joinedDaysAgo: number | null;
  /** How often they come to a prickle they could attend (0 to 1). */
  rate: number;
  bio?: string;
}

/** One slot of the week's rhythm; the calendar title is "Type w/Host", or just "Type" when nobody hosts. */
export interface ProfileSlot {
  /** 0 is Sunday. */
  weekday: number;
  /** Local start in the organization's timezone. */
  startLocal: string;
  minutes: number;
  summary: string;
}

export interface ProfileBadge {
  key: string;
  name: string;
  icon: string;
  category: string;
  /** Who holds it and how many days ago they earned it. */
  awardedTo: { person: string; daysAgo: number; note?: string }[];
}

export interface ProfileNotification {
  /** The person it was sent to. */
  person: string;
  kind: string;
  text: string;
  url: string | null;
  minutesAgo: number;
  read: boolean;
}

export interface SeedProfile {
  name: string;
  people: ProfilePerson[];
  weeklyPattern: ProfileSlot[];
  /** How far back and ahead the prickles run, in days from today. */
  history: { daysBack: number; daysAhead: number };
  badges: ProfileBadge[];
  notifications: ProfileNotification[];
}

/** FNV-1a mapped to [0, 1): the same input gives the same crowd on every run and machine. */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A stable id for a seeded thing: `<prefix>_` and 12 base58 characters derived from `text`. */
export function seedId(prefix: string, text: string): string {
  let id = "";
  for (let i = 0; id.length < 12; i++) id += BASE58[Math.floor(hash01(`${text}|${i}`) * BASE58.length)];
  return `${prefix}_${id}`;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The host named in a calendar title ("Progress Prickle w/Hazel Hosting"), or null for a prickle without one. */
export function hostNamed(summary: string): string | null {
  return /\bw\/\s*(.+?)\s*$/i.exec(summary)?.[1] ?? null;
}

/** The type named in a calendar title: everything before " w/". */
export function typeNamed(summary: string): string {
  return summary.replace(/\s*\bw\/.*$/i, "").trim();
}

/** The weekday (0 = Sunday) of `date` in `timeZone`. */
function weekdayIn(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** The calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
function dateIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** The UTC instant of a local date and time in `timeZone`, found by correcting for the zone's offset at that moment. */
function localToUtc(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc.getTime() - shown.getTime()));
}

export interface BuildOptions {
  /** The zone the weekly pattern's local times are in. */
  timeZone: string;
}

/**
 * The profile as typed rows, relative to `now`: its people as members, a prickle type per distinct
 * title, a prickle for each slot of the weekly rhythm across the history window (hosted by the named
 * member), who attended the ones that have ended, the badges and the notifications. Deterministic
 * for a given profile and `now`.
 */
export function buildDataset(profile: SeedProfile, now: Date, { timeZone }: BuildOptions): InMemoryDataset {
  const today = dateIn(now, timeZone);
  const personId = new Map<string, string>(profile.people.map((p) => [p.key, seedId("mbr", p.email)]));
  const idOf = (key: string) => {
    const id = personId.get(key);
    if (!id) throw new Error(`Seed profile "${profile.name}" has no person "${key}"`);
    return id;
  };

  const withRecord = profile.people.filter((p) => p.joinedDaysAgo !== null);
  const members = withRecord.map((p) => ({
    id: idOf(p.key),
    name: p.name,
    email: p.email,
    status: "active",
    source: "kajabi",
    bio: p.bio ?? null,
    joinedAt: new Date(now.getTime() - (p.joinedDaysAgo as number) * DAY).toISOString().slice(0, 10),
  }));

  const typeNames = [...new Set(profile.weeklyPattern.map((s) => typeNamed(s.summary)))];
  const prickleTypes: PrickleType[] = typeNames.map((name) => ({
    id: seedId("prty", name),
    name,
    normalizedName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    purpose: "writing",
    requiresHost: profile.weeklyPattern.some((s) => typeNamed(s.summary) === name && hostNamed(s.summary) !== null),
    soloTaskFriendly: false,
  }));
  const typeId = new Map(prickleTypes.map((t) => [t.name, t.id]));

  const prickles: Prickle[] = [];
  for (let offset = -profile.history.daysBack; offset <= profile.history.daysAhead; offset++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + offset * DAY);
    const date = day.toISOString().slice(0, 10);
    const weekday = weekdayIn(day, timeZone);
    for (const slot of profile.weeklyPattern.filter((s) => s.weekday === weekday)) {
      const start = localToUtc(date, slot.startLocal, timeZone);
      const host = hostNamed(slot.summary);
      const hostPerson = host ? profile.people.find((p) => p.name === host && p.joinedDaysAgo !== null) : undefined;
      prickles.push({
        id: seedId("prkl", `${date}|${slot.startLocal}|${slot.summary}`),
        typeId: typeId.get(typeNamed(slot.summary)) ?? null,
        hostId: hostPerson ? idOf(hostPerson.key) : null,
        title: null,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + slot.minutes * MINUTE).toISOString(),
        source: "calendar",
        calendarEventId: null,
      });
    }
  }

  const attendance: AttendanceRow[] = [];
  for (const prickle of prickles) {
    const start = Date.parse(prickle.startTime);
    const end = Date.parse(prickle.endTime);
    if (end > now.getTime()) continue; // upcoming: nobody has come yet
    for (const person of withRecord) {
      const memberId = idOf(person.key);
      const isHost = prickle.hostId === memberId;
      const joinedAt = now.getTime() - (person.joinedDaysAgo as number) * DAY;
      const roll = (suffix: string) => hash01(`${prickle.id}|${person.email}|${suffix}`);
      if (!isHost && (joinedAt > start || roll("") >= person.rate)) continue;

      const row = (join: number, leave: number, n: number): AttendanceRow => ({
        id: seedId("att", `${prickle.id}|${person.email}|${n}`),
        memberId,
        prickleId: prickle.id,
        joinTime: new Date(join).toISOString(),
        leaveTime: new Date(leave).toISOString(),
      });
      if (isHost) {
        attendance.push(row(start - (1 + Math.floor(roll("early") * 3)) * MINUTE, end + MINUTE, 0));
        continue;
      }
      const joinAt = start + Math.floor(roll("join") * 9) * MINUTE;
      const shape = roll("shape");
      if (shape < 0.15) {
        const leaveAt = end - (5 + Math.floor(roll("early") * 16)) * MINUTE;
        if (leaveAt > joinAt) attendance.push(row(joinAt, leaveAt, 0));
      } else if (shape < 0.25) {
        // Steps out for a few minutes in the middle and comes back: one prickle, two attendance rows.
        const middle = (start + end) / 2;
        if (middle > joinAt) {
          attendance.push(row(joinAt, middle, 0));
          attendance.push(row(middle + 4 * MINUTE, end + MINUTE, 1));
        }
      } else {
        attendance.push(row(joinAt, end + MINUTE, 0));
      }
    }
  }

  const badgeTypes: BadgeType[] = profile.badges.map((b) => ({
    id: seedId("bdgt", b.key),
    key: b.key,
    name: b.name,
    description: null,
    icon: b.icon,
    category: b.category,
    has_levels: false,
    is_automatic: false,
    program_id: null,
    event_id: null,
  }));
  const memberBadges: MemberBadge[] = profile.badges.flatMap((b) =>
    b.awardedTo.map((a) => ({
      id: seedId("mbdg", `${b.key}|${a.person}`),
      memberId: idOf(a.person),
      badgeTypeId: seedId("bdgt", b.key),
      occurredAt: new Date(now.getTime() - a.daysAgo * DAY).toISOString().slice(0, 10),
      note: a.note ?? null,
      eventId: null,
      awardedBy: null,
    })),
  );

  const inAppNotifications: InAppNotificationRow[] = profile.notifications.map((n, i) => ({
    id: seedId("ntf", `${n.person}|${n.kind}|${i}`),
    memberId: idOf(n.person),
    kind: n.kind,
    ref: null,
    text: n.text,
    url: n.url,
    bannerUntil: null,
    readAt: n.read ? new Date(now.getTime() - n.minutesAgo * MINUTE + MINUTE).toISOString() : null,
    createdAt: new Date(now.getTime() - n.minutesAgo * MINUTE).toISOString(),
  }));

  return new InMemoryDataset({ members, prickleTypes, prickles, attendance, badgeTypes, memberBadges, inAppNotifications });
}
