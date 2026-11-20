import { ORG_TIMEZONE } from "@/lib/config";
import type { Repos } from "@/lib/data/repos";
import type { UpcomingAnnouncedEvent } from "@/lib/data/events";
import { eventSignups } from "@/lib/event-signup";
import { dateIn, formatTimeSpan, isAllDay } from "@/lib/events-agenda";
import { isEventType, type EventType } from "@/lib/events-filter";
import { kindLabel } from "./live-kinds";
import { publicTitle } from "./live-schedule";

/**
 * The events behind the Coming up block (docs/LANDING_PAGES.md, "Live data").
 *
 * Which events may appear: shown in Events (not hidden) and **announced publicly** (`community_events.announced_publicly`, the
 * audience chain in docs/CALENDAR_EVENTS.md; the flag means "may be listed in a Coming up list", not that it is secret), starting
 * after now, soonest first.
 *
 * What may appear: the cleaned title (no host or speaker added to it, like the public schedule), a plain kind, the days (and the time of day when the event has one), and, for an event that
 * sells places through a linked Kajabi offer and has a capacity, how many places are left. Never who is registered, never a count
 * of registrants, no ids. The only link is the checkout address of the event's linked offer: the member event pages need a sign-in.
 */

/** How many cards a block may show, and the default. */
export const COMING_UP_MAX = 4;
/** How far past the block's own limit the snapshot reads, so events that start in the minute the cache holds it are still replaced. */
const SNAPSHOT_SLACK = 2;

export type ComingUpOptions = { kinds: EventType[]; max: number };

/** The block's options as stored, made safe: only known kinds (none chosen means every kind), a limit of 1 to 4 (default 4). */
export function comingUpOptions(props: { kinds?: unknown; max?: unknown }): ComingUpOptions {
  const kinds = Array.isArray(props.kinds) ? [...new Set(props.kinds.filter(isEventType))].sort() : [];
  const n = Math.floor(Number(props.max));
  return { kinds, max: Number.isFinite(n) ? Math.min(COMING_UP_MAX, Math.max(1, n)) : COMING_UP_MAX };
}

/** The same options as a stable string, so equal options share one load and one cache entry. */
export const comingUpKey = (options: ComingUpOptions) => `${options.max}:${options.kinds.join(",")}`;

/**
 * What one event shows. `date` is its first Eastern day (YYYY-MM-DD, for the list's date tile), `time` the line under a list row's
 * title (the time of day of a timed single-day event, the dates of a several-day one, nothing for an all-day day), `soldOut` whether
 * it has a capacity, a linked offer and no places left, and `imageAssetId` its cover when, and only when, that asset is public ("" otherwise).
 */
export type ComingUpCard = { kind: string; title: string; when: string; availability: string; linkLabel: string; href: string; date: string; time: string; soldOut: boolean; imageAssetId: string };
/** What is cached for a minute and handed to every visitor: nothing here is about a person. `startTime` lets the render drop an event that has started since. */
export type ComingUpSnapshot = { events: (ComingUpCard & { startTime: string })[] };

export const SIGN_UP_LABEL = "Sign up";
export const SOLD_OUT_TEXT = "Sold out";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, month: MONTHS[m - 1], d };
};

/**
 * "Mar 14", "Mar 14 to 16", "Mar 30 to Apr 2" for Eastern days (`starts_at`/`ends_at`: YYYY-MM-DD), with the year when it is not
 * the current Eastern year or the span crosses a year. A timed single-day event adds its time and zone ("Mar 14, 7 pm ET");
 * an all-day or multi-day event gives dates only, so the zone is named only where a time is shown.
 */
export function formatEventWhen(event: Pick<UpcomingAnnouncedEvent, "start_time" | "end_time" | "starts_at" | "ends_at">, nowDate: Date): string {
  const first = parts(event.starts_at);
  const last = parts(event.ends_at);
  const thisYear = Number(dateIn(nowDate.toISOString(), ORG_TIMEZONE).slice(0, 4));
  const yearOf = (p: { y: number }) => (p.y === thisYear ? "" : `, ${p.y}`);
  if (event.starts_at >= event.ends_at) {
    const day = `${first.month} ${first.d}${yearOf(first)}`;
    const time = isAllDay(event.start_time, event.end_time) ? "" : formatTimeSpan(event.start_time, event.end_time, ORG_TIMEZONE);
    return time ? `${day}, ${time}` : day;
  }
  if (first.y !== last.y) return `${first.month} ${first.d}, ${first.y} to ${last.month} ${last.d}, ${last.y}`;
  if (first.month === last.month) return `${first.month} ${first.d} to ${last.d}${yearOf(first)}`;
  return `${first.month} ${first.d} to ${last.month} ${last.d}${yearOf(first)}`;
}

/** "6 spots left", "1 spot left", "Sold out"; "" when the places left are not known (no capacity, or no linked offer to count against). */
export function availabilityText(signup: { spotsLeft: number | null; soldOut: boolean } | undefined): string {
  if (!signup || signup.spotsLeft === null) return "";
  if (signup.soldOut || signup.spotsLeft <= 0) return SOLD_OUT_TEXT;
  return `${signup.spotsLeft} ${signup.spotsLeft === 1 ? "spot" : "spots"} left`;
}

type ComingUpRepos = Pick<Repos, "aliases" | "billing" | "events" | "media" | "members">;

/**
 * The cover of each event whose cover a signed-out visitor may be served: the asset is a live image marked `is_public`
 * (docs/LANDING_PAGES.md, "Pictures and public assets"; an admin's save of a publicly announced event marks it, `publishEventCover`).
 * Anything else, or a read that fails, is simply no picture: the tile falls back to its neutral look and the page never breaks for
 * an image. Only the asset id leaves, which the block turns into the same `/api/media/<id>/<preset>` address every landing picture uses.
 */
async function publicCovers(media: ComingUpRepos["media"], events: { id: string; image_id: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(events.flatMap((e) => (e.image_id ? [e.image_id] : [])))];
  const assets = await Promise.all(ids.map((id) => media.byId(id).catch(() => null)));
  const open = new Set(assets.flatMap((a) => (a && a.is_public && !a.deleted_at && a.kind === "image" ? [a.id] : [])));
  return new Map(events.flatMap((e) => (e.image_id && open.has(e.image_id) ? [[e.id, e.image_id] as const] : [])));
}

/** The line under a list row's title: the time of a timed single-day event, the dates of a several-day one, "" for an all-day day. */
function listTime(event: Pick<UpcomingAnnouncedEvent, "start_time" | "end_time" | "starts_at" | "ends_at">, when: string): string {
  if (event.starts_at < event.ends_at) return when;
  return isAllDay(event.start_time, event.end_time) ? "" : formatTimeSpan(event.start_time, event.end_time, ORG_TIMEZONE);
}

/**
 * The next events for a block's options, ready to show. Places left come from `eventSignups` (the same count the member Events page
 * shows: attendees plus active purchases of the linked offers, once per person), read with the service role; the result holds counts
 * and a public checkout address only. Throws on a read failure: the caller falls back to the typed cards.
 */
export async function loadComingUp(repos: ComingUpRepos, options: ComingUpOptions, nowDate: Date): Promise<ComingUpSnapshot> {
  const found = await repos.events.upcomingAnnounced({ from: nowDate.toISOString(), limit: options.max + SNAPSHOT_SLACK, kinds: options.kinds });
  if (found.length === 0) return { events: [] };
  const [signups, covers] = await Promise.all([eventSignups(repos, found.map((e) => ({ id: e.id, capacity: e.capacity }))), publicCovers(repos.media, found)]);
  return {
    events: found.map((e) => {
      const signup = signups.get(e.id);
      const availability = availabilityText(signup);
      const soldOut = availability === SOLD_OUT_TEXT;
      // A link only while there are places and a checkout page to go to.
      const href = signup?.checkoutUrl && !soldOut ? signup.checkoutUrl : "";
      const when = formatEventWhen(e, nowDate);
      return {
        kind: kindLabel(e.event_type),
        title: publicTitle(e.title, null),
        when,
        availability,
        linkLabel: href ? SIGN_UP_LABEL : "",
        href,
        date: e.starts_at,
        time: listTime(e, when),
        soldOut,
        imageAssetId: covers.get(e.id) ?? "",
        startTime: e.start_time,
      };
    }),
  };
}

/** The cards to show now: the snapshot's events that have not started, at most the block's limit. */
export function comingUpCards(snapshot: ComingUpSnapshot, nowDate: Date, options: ComingUpOptions): ComingUpCard[] {
  return snapshot.events
    .filter((e) => Date.parse(e.startTime) > nowDate.getTime())
    .slice(0, options.max)
    .map(({ startTime: _startTime, ...card }) => card); // eslint-disable-line @typescript-eslint/no-unused-vars
}
