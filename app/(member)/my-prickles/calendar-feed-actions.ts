"use server";

import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { calendarFeedUrls, SCHEDULE_TIMEZONE, type CalendarFeedUrls, type MyCalendarItem } from "@/lib/calendar-feed";
import { formatSlotLabel, slotKey, slotTimeForInstant } from "@/lib/commitments";

/** Labels fall back to the org's timezone when the member's preference is "browser" (the server
 * can't see the browser's), same as the My Prickles page. Labels always name the zone. */
const ORG_TIMEZONE = "America/New_York";

function newToken(): string {
  return randomBytes(16).toString("hex");
}

/** This request's origin (scheme + host), so feed links point at whichever deployment served the page. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "hub.quillandcup.com";
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
  const supabase = await createClient();

  const { data: existing, error } = await supabase
    .from("calendar_feed_tokens")
    .select("token")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) {
    console.error("getMyCalendarFeedUrls: failed to load token", error);
    return null;
  }
  if (existing) return calendarFeedUrls(await requestOrigin(), existing.token);

  // First visit. ignoreDuplicates: if a concurrent request created one first, keep theirs.
  const { error: insertError } = await supabase
    .from("calendar_feed_tokens")
    .upsert({ member_id: memberId, token: newToken() }, { onConflict: "member_id", ignoreDuplicates: true });
  if (insertError) {
    console.error("getMyCalendarFeedUrls: failed to create token", insertError);
    return null;
  }
  const { data: created } = await supabase
    .from("calendar_feed_tokens")
    .select("token")
    .eq("member_id", memberId)
    .maybeSingle();
  return created ? calendarFeedUrls(await requestOrigin(), created.token) : null;
}

/**
 * Replace the acting member's token ("Generate new link"). Every calendar subscribed to the old
 * link stops updating; the member re-subscribes with the new one.
 */
export async function regenerateMyCalendarFeedToken(): Promise<{ urls: CalendarFeedUrls } | { error: string }> {
  const memberId = await effectiveMemberId();
  if (!memberId) return { error: "Not signed in" };
  const supabase = await createClient();

  const { error } = await supabase
    .from("calendar_feed_tokens")
    .upsert(
      { member_id: memberId, token: newToken(), updated_at: new Date().toISOString() },
      { onConflict: "member_id" }
    );
  if (error) {
    console.error("regenerateMyCalendarFeedToken: failed", error);
    return { error: "Couldn't generate a new link. Please try again." };
  }
  const { data } = await supabase.from("calendar_feed_tokens").select("token").eq("member_id", memberId).single();
  if (!data) return { error: "Couldn't generate a new link. Please try again." };
  return { urls: calendarFeedUrls(await requestOrigin(), data.token) };
}

// ---------------------------------------------------------------------------------------------
// Items added by hand (calendar_feed_items): on top of hosted + committed prickles.
// ---------------------------------------------------------------------------------------------

type ItemResult = { ok: true } | { error: string };

type NameRef = { name?: string; title?: string } | { name?: string; title?: string }[] | null;
const first = (ref: NameRef) => (Array.isArray(ref) ? ref[0] : ref) ?? null;

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
  const supabase = await createClient();
  const [timeZone, { data, error }] = await Promise.all([
    viewerTimeZone(),
    supabase
      .from("calendar_feed_items")
      .select(
        "id, kind, type_id, start_time, day_of_week, start_time_local, timezone, event_id, created_at, prickle_types(name), events(title, starts_at, ends_at)"
      )
      .eq("member_id", memberId)
      .order("created_at"),
  ]);
  if (error) {
    console.error("getMyCalendarItems: failed to load items", error);
    return [];
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const items: MyCalendarItem[] = [];
  for (const row of data ?? []) {
    const typeName = first(row.prickle_types as NameRef)?.name ?? "Prickle";
    if (row.kind === "prickle") {
      if (new Date(row.start_time).getTime() < now) continue;
      items.push({
        id: row.id,
        kind: "prickle",
        label: `${typeName} · ${formatWhen(row.start_time, timeZone)}`,
        typeId: row.type_id,
        startTime: new Date(row.start_time).toISOString(),
      });
    } else if (row.kind === "slot") {
      const slot = { typeId: row.type_id, dayOfWeek: row.day_of_week, startTimeLocal: row.start_time_local, timezone: row.timezone };
      items.push({ id: row.id, kind: "slot", label: formatSlotLabel(typeName, slot), slotKey: slotKey(slot) });
    } else {
      const event = first(row.events as NameRef) as { title: string; starts_at: string; ends_at: string } | null;
      if (!event || event.ends_at < today) continue;
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

/** Insert one item for the acting member; an item they already have counts as success. */
async function addItem(row: Record<string, unknown>): Promise<ItemResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const memberId = (await getEffectiveIdentity(user))?.memberId;
  if (!memberId) return { error: "Not signed in" };
  const supabase = await createClient();

  const { error } = await supabase.from("calendar_feed_items").insert({ ...row, member_id: memberId, created_by: user.id });
  if (error && error.code !== "23505") {
    console.error("addItem: failed to add calendar item", { row, error });
    return { error: "Couldn't add that to your calendar. Please try again." };
  }
  revalidatePath("/my-prickles");
  return { ok: true };
}

/**
 * Add a prickle to the acting member's calendar feed: just this occurrence ("once"), or its
 * weekly slot, ongoing ("weekly"). The prickle is looked up server-side and stored by type + time
 * (its id changes when prickles are reprocessed). A weekly slot is the prickle's weekday and
 * start time in SCHEDULE_TIMEZONE, the timezone the schedule repeats in.
 */
export async function addPrickleToMyCalendar(prickleId: string, mode: "once" | "weekly"): Promise<ItemResult> {
  if (mode !== "once" && mode !== "weekly") return { error: "Invalid option" };
  const supabase = await createClient();
  const { data: prickle } = await supabase.from("prickles").select("type_id, start_time").eq("id", prickleId).maybeSingle();
  if (!prickle) return { error: "That prickle isn't on the schedule anymore." };
  if (!prickle.type_id) return { error: "That prickle can't be added to your calendar." };

  if (mode === "once") {
    return addItem({ kind: "prickle", type_id: prickle.type_id, start_time: prickle.start_time });
  }
  const { dayOfWeek, startTimeLocal } = slotTimeForInstant(prickle.start_time, SCHEDULE_TIMEZONE);
  return addItem({
    kind: "slot",
    type_id: prickle.type_id,
    day_of_week: dayOfWeek,
    start_time_local: startTimeLocal,
    timezone: SCHEDULE_TIMEZONE,
  });
}

/** Add an event (e.g. a retreat) to the acting member's calendar feed. */
export async function addEventToMyCalendar(eventId: string): Promise<ItemResult> {
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!event) return { error: "That event couldn't be found." };
  return addItem({ kind: "event", event_id: event.id });
}

/** Remove one of the acting member's added items (RLS scopes the delete to their own rows). */
export async function removeMyCalendarItem(itemId: string): Promise<ItemResult> {
  const memberId = await effectiveMemberId();
  if (!memberId) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_feed_items").delete().eq("id", itemId).eq("member_id", memberId);
  if (error) {
    console.error("removeMyCalendarItem: failed", error);
    return { error: "Couldn't remove that. Please try again." };
  }
  revalidatePath("/my-prickles");
  return { ok: true };
}
