"use server";

import { createRepos } from "@/lib/data/repos";
import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { refresh, revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { NewFeedItem } from "@/lib/data/calendar-feed";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { calendarFeedUrls, SCHEDULE_TIMEZONE, type CalendarFeedUrls, type MyCalendarItem } from "@/lib/calendar-feed";
import { formatSlotLabel, slotInTimeZone, slotKey, slotTimeForInstant } from "@/lib/commitments";
import { APP_URL, ORG_TIMEZONE } from "@/lib/config";

import { withAction } from "@/lib/analytics/server";
/** Labels fall back to the org's timezone when the member's preference is "browser" (the server
 * can't see the browser's), same as the My Prickles page. Labels always name the zone. */

function newToken(): string {
  return randomBytes(16).toString("hex");
}

/** This request's origin (scheme + host), so feed links point at whichever deployment served the page. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return APP_URL;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

async function effectiveMemberId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return (await getEffectiveIdentity(user))?.memberId ?? null;
}

async function viewerTimeZone(): Promise<string> {
  const pref = await getUserTimezonePreference();
  return pref === "browser" ? ORG_TIMEZONE : pref;
}

/**
 * The acting member's calendar feed links, creating their token on first use. Sudo-aware: under
 * sudo it's the viewed member's feed. Returns null if there's no member or the token can't be
 * stored (the page just omits the sync card).
 */
export async function getMyCalendarFeedUrls(): Promise<CalendarFeedUrls | null> {
  const memberId = await effectiveMemberId();
  if (!memberId) return null;
  const feed = createRepos(await createClient()).calendarFeed;

  let existing: string | null;
  try {
    existing = await feed.tokenOf(memberId);
  } catch (error) {
    console.error("getMyCalendarFeedUrls: failed to load token", error);
    return null;
  }
  if (existing) return calendarFeedUrls(await requestOrigin(), existing);

  // First visit. A concurrent request that created one first wins; keep theirs.
  try {
    await feed.createTokenIfMissing(memberId, newToken());
  } catch (error) {
    console.error("getMyCalendarFeedUrls: failed to create token", error);
    return null;
  }
  const created = await feed.tokenOf(memberId).catch(() => null);
  return created ? calendarFeedUrls(await requestOrigin(), created) : null;
}

/**
 * Replace the acting member's token ("Generate new link"). Every calendar subscribed to the old
 * link stops updating; the member re-subscribes with the new one.
 */
async function regenerateMyCalendarFeedTokenImpl(): Promise<{ urls: CalendarFeedUrls } | { error: string }> {
  const memberId = await effectiveMemberId();
  if (!memberId) return { error: "Not signed in" };
  const feed = createRepos(await createClient()).calendarFeed;
  try {
    await feed.replaceToken(memberId, newToken());
  } catch (error) {
    console.error("regenerateMyCalendarFeedToken: failed", error);
    return { error: "Couldn't generate a new link. Please try again." };
  }
  const token = await feed.tokenOf(memberId).catch(() => null);
  if (!token) return { error: "Couldn't generate a new link. Please try again." };
  return { urls: calendarFeedUrls(await requestOrigin(), token) };
}

// ---------------------------------------------------------------------------------------------
// Items added by hand (calendar_feed_items): on top of hosted + committed prickles.
// ---------------------------------------------------------------------------------------------

type ItemResult = { ok: true } | { error: string };

function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function formatDateRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/**
 * What the acting member added to their calendar feed, still ahead of them (past one-offs and
 * finished events stay in the feed for its lookback, but aren't worth listing), oldest first.
 */
export async function getMyCalendarItems(): Promise<MyCalendarItem[]> {
  const memberId = await effectiveMemberId();
  if (!memberId) return [];
  const feed = createRepos(await createClient()).calendarFeed;
  const [timeZone, rows] = await Promise.all([
    viewerTimeZone(),
    feed.listedItemsOf(memberId).catch((error) => {
      console.error("getMyCalendarItems: failed to load items", error);
      return null;
    }),
  ]);
  if (!rows) return [];

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const items: MyCalendarItem[] = [];
  for (const row of rows) {
    const typeName = row.type_name ?? "Prickle";
    if (row.kind === "prickle") {
      const prickle = row.prickle;
      if (!prickle || !row.prickle_id || new Date(prickle.start_time).getTime() < now) continue;
      const prickleTypeName = prickle.type_name ?? "Prickle";
      items.push({
        id: row.id,
        kind: "prickle",
        label: `${prickleTypeName} · ${formatWhen(prickle.start_time, timeZone)}`,
        prickleId: row.prickle_id,
      });
    } else if (row.kind === "slot") {
      if (row.type_id === null || row.day_of_week === null || row.start_time_local === null || row.timezone === null) continue;
      const slot = { typeId: row.type_id, dayOfWeek: row.day_of_week, startTimeLocal: row.start_time_local, timezone: row.timezone };
      items.push({
        id: row.id,
        kind: "slot",
        label: formatSlotLabel(typeName, slotInTimeZone(slot, timeZone)),
        slotKey: slotKey(slot),
      });
    } else {
      const event = row.event;
      if (!event || !row.event_id || event.ends_at < today) continue;
      items.push({
        id: row.id,
        kind: "event",
        label: `${event.title} · ${formatDateRange(event.starts_at, event.ends_at)}`,
        eventId: row.event_id,
      });
    }
  }
  return items;
}

/**
 * After an add/remove: mark My Prickles stale, and re-render whichever page the member is on (a
 * prickle's or event's page too) in this same action response, so the client doesn't need a
 * second router.refresh() round trip.
 */
function revalidateCalendarViews() {
  revalidatePath("/my-prickles", "layout");
  refresh();
}

/** Insert one item for the acting member; an item they already have counts as success. */
async function addItem(row: NewFeedItem): Promise<ItemResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const memberId = (await getEffectiveIdentity(user))?.memberId;
  if (!memberId) return { error: "Not signed in" };
  const supabase = await createClient();

  // An item they already have counts as success.
  try {
    await createRepos(supabase).calendarFeed.addItem(memberId, user.id, row);
  } catch (error) {
    console.error("addItem: failed to add calendar item", { row, error });
    return { error: "Couldn't add that to your calendar. Please try again." };
  }
  revalidateCalendarViews();
  return { ok: true };
}

/**
 * Add a prickle to the acting member's calendar feed: just this prickle ("once", by id -- prickle
 * ids are stable), or its weekly slot, ongoing ("weekly"): the prickle's weekday and start time in
 * SCHEDULE_TIMEZONE, the timezone the schedule repeats in.
 */
async function addPrickleToMyCalendarImpl(prickleId: string, mode: "once" | "weekly"): Promise<ItemResult> {
  if (mode !== "once" && mode !== "weekly") return { error: "Invalid option" };
  const supabase = await createClient();
  const prickle = await createRepos(supabase).prickles.byId(prickleId);
  if (!prickle) return { error: "That prickle isn't on the schedule anymore." };
  if (!prickle.typeId) return { error: "That prickle can't be added to your calendar." };

  if (mode === "once") {
    return addItem({ kind: "prickle", prickle_id: prickle.id });
  }
  const { dayOfWeek, startTimeLocal } = slotTimeForInstant(prickle.startTime, SCHEDULE_TIMEZONE);
  return addItem({
    kind: "slot",
    type_id: prickle.typeId,
    day_of_week: dayOfWeek,
    start_time_local: startTimeLocal,
    timezone: SCHEDULE_TIMEZONE,
  });
}

/** Add an event (e.g. a retreat) to the acting member's calendar feed. */
async function addEventToMyCalendarImpl(eventId: string): Promise<ItemResult> {
  const supabase = await createClient();
  if (!(await createRepos(supabase).events.isVisible(eventId))) return { error: "That event couldn't be found." };
  return addItem({ kind: "event", event_id: eventId });
}

/** Remove one of the acting member's added items (RLS scopes the delete to their own rows). */
export async function removeMyCalendarItem(itemId: string): Promise<ItemResult> {
  const memberId = await effectiveMemberId();
  if (!memberId) return { error: "Not signed in" };
  const supabase = await createClient();
  try {
    await createRepos(supabase).calendarFeed.removeItem(memberId, itemId);
  } catch (error) {
    console.error("removeMyCalendarItem: failed", error);
    return { error: "Couldn't remove that. Please try again." };
  }
  revalidateCalendarViews();
  return { ok: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function addPrickleToMyCalendar(...args: Parameters<typeof addPrickleToMyCalendarImpl>): ReturnType<typeof addPrickleToMyCalendarImpl> {
  return withAction("calendar_item_added", () => addPrickleToMyCalendarImpl(...args));
}

export async function addEventToMyCalendar(...args: Parameters<typeof addEventToMyCalendarImpl>): ReturnType<typeof addEventToMyCalendarImpl> {
  return withAction("calendar_item_added", () => addEventToMyCalendarImpl(...args));
}

export async function regenerateMyCalendarFeedToken(...args: Parameters<typeof regenerateMyCalendarFeedTokenImpl>): ReturnType<typeof regenerateMyCalendarFeedTokenImpl> {
  return withAction("calendar_feed_regenerated", () => regenerateMyCalendarFeedTokenImpl(...args));
}
