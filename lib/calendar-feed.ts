import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commitmentsFetchWindow,
  computeCommitmentProgress,
  formatCommitmentTitle,
  prickleMatchesSlot,
  type Commitment,
  type CommitmentSlot,
  type CommitmentStatus,
  type SlotPrickle,
} from "@/lib/commitments";
import { hostShortName } from "@/lib/formatters";
import { formatUtc, type ICalEvent } from "@/lib/ical";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { APP_URL } from "@/lib/config";

/**
 * A member's personal calendar feed (/api/calendar/feed/<token>.ics). It includes the prickles
 * they host and the ones they've committed to automatically, plus prickles and events they added
 * by hand (calendar_feed_items). See supabase/migrations/20260928000000_create_calendar_feed_tokens.sql
 * and 20260928000100_create_calendar_feed_items.sql.
 */

export const CALENDAR_FEED_NAME = "My Prickles · Hedgie Hub";
/** How far back the feed reaches, so recent prickles don't vanish from the calendar the moment they end. */
export const FEED_LOOKBACK_DAYS = 30;
export const FEED_REMINDER_MINUTES = 15;
/** Suggested refresh interval. Apple and Outlook honor it; Google refreshes on its own (12-24 h). */
export const FEED_REFRESH_MINUTES = 60;
/** Length of a committed occurrence that isn't on the prickle calendar yet. */
const UNSCHEDULED_DURATION_MINUTES = 60;
// Event UIDs must stay stable or subscribed calendars duplicate every event, so this follows
// the canonical app URL (production: hub.quillandcup.com), not whichever host served the request.
const UID_DOMAIN = new URL(APP_URL).host;

export interface CalendarFeedUrls {
  /** The feed itself -- what "Copy link" copies and what Outlook fetches. */
  https: string;
  /** Same feed with the webcal: scheme, which opens the subscribe prompt in Apple Calendar. */
  webcal: string;
  google: string;
  outlook: string;
}

export function calendarFeedUrls(origin: string, token: string): CalendarFeedUrls {
  const https = `${origin}/api/calendar/feed/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(CALENDAR_FEED_NAME)}`,
  };
}

/** Re-exported for the feed's callers; see lib/commitments.ts. */
export { SCHEDULE_TIMEZONE } from "@/lib/commitments";

/** An item the member added to their feed by hand (calendar_feed_items), as listed in the UI. */
export type MyCalendarItem =
  | { id: string; kind: "prickle"; label: string; prickleId: string }
  | { id: string; kind: "slot"; label: string; slotKey: string }
  | { id: string; kind: "event"; label: string; eventId: string };

/** Which of the member's added items cover one prickle: just that occurrence, and/or its weekly slot. */
export interface PrickleCalendarState {
  onceItemId: string | null;
  weeklyItemId: string | null;
}

export function prickleCalendarState(
  items: readonly MyCalendarItem[],
  prickleId: string,
  weeklySlotKey: string | null
): PrickleCalendarState {
  let onceItemId: string | null = null;
  let weeklyItemId: string | null = null;
  for (const item of items) {
    if (item.kind === "prickle" && item.prickleId === prickleId) {
      onceItemId = item.id;
    } else if (item.kind === "slot" && weeklySlotKey && item.slotKey === weeklySlotKey) {
      weeklyItemId = item.id;
    }
  }
  return { onceItemId, weeklyItemId };
}

/** The token from a feed path segment: "<32 hex>.ics" (or bare), else null. */
export function parseFeedToken(segment: string): string | null {
  const match = /^([0-9a-f]{32})(\.ics)?$/.exec(segment);
  return match ? match[1] : null;
}

export interface FeedPrickle {
  id: string;
  typeId: string | null;
  typeName: string;
  hostName: string | null;
  startTime: string;
  endTime: string;
}

export interface CommittedOccurrence {
  /** The scheduled prickle this occurrence matched, or null if none is on the calendar yet. */
  prickle: FeedPrickle | null;
  typeId: string;
  typeName: string;
  /** The committed wall-clock start (UTC ISO), used when there's no prickle. */
  expectedStart: string;
  commitmentTitle: string;
}

/** An event (retreat etc.) the member added. Dates are inclusive local calendar dates. */
export interface FeedEventRow {
  id: string;
  slug: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
}

/** Scheduled prickles are keyed (and UID'd) by id: prickle ids are stable across reprocessing
 * (calendar prickles upsert on calendar_event_id, PUPs on zoom_meeting_uuid), so a rescheduled
 * prickle moves in the member's calendar instead of being dropped and re-added. */
function prickleKey(prickleId: string): string {
  return `prickle-${prickleId}`;
}

/** A committed occurrence with no prickle on the schedule yet: keyed by slot type + expected time. */
function unscheduledKey(typeId: string, start: Date): string {
  return `unscheduled-${typeId}-${formatUtc(start)}`;
}

/**
 * Hosted prickles, committed occurrences, and added prickles and events as calendar events, one
 * per prickle: a prickle that qualifies more than once shows once, as hosting, else as committed,
 * else as added.
 */
export function buildCalendarFeedEvents({
  memberId,
  origin,
  hosted,
  committed,
  added = [],
  events: addedEvents = [],
}: {
  memberId: string;
  origin: string;
  hosted: FeedPrickle[];
  committed: CommittedOccurrence[];
  /** Prickles added by hand, one occurrence or every week of a slot, already resolved to prickles. */
  added?: FeedPrickle[];
  events?: FeedEventRow[];
}): ICalEvent[] {
  const events = new Map<string, ICalEvent>();
  const uid = (key: string) => `${key}.${memberId}@${UID_DOMAIN}`;
  const prickleUrl = (id: string) => `${origin}/prickles/${id}`;

  for (const p of hosted) {
    const start = new Date(p.startTime);
    const key = prickleKey(p.id);
    events.set(key, {
      uid: uid(key),
      start,
      end: new Date(p.endTime),
      summary: `Hosting: ${p.typeName}`,
      description: `You're hosting this ${p.typeName}.\n\n${prickleUrl(p.id)}`,
      url: prickleUrl(p.id),
      reminderMinutes: FEED_REMINDER_MINUTES,
    });
  }

  for (const o of committed) {
    if (o.prickle) {
      const p = o.prickle;
      const start = new Date(p.startTime);
      const key = prickleKey(p.id);
      if (events.has(key)) continue; // hosting it too
      events.set(key, {
        uid: uid(key),
        start,
        end: new Date(p.endTime),
        summary: p.hostName ? `${p.typeName} with ${hostShortName(p.hostName)}` : p.typeName,
        description: `Part of your commitment: ${o.commitmentTitle}\n\n${prickleUrl(p.id)}`,
        url: prickleUrl(p.id),
        reminderMinutes: FEED_REMINDER_MINUTES,
      });
    } else {
      const start = new Date(o.expectedStart);
      const key = unscheduledKey(o.typeId, start);
      if (events.has(key)) continue;
      events.set(key, {
        uid: uid(key),
        start,
        end: new Date(start.getTime() + UNSCHEDULED_DURATION_MINUTES * 60 * 1000),
        summary: o.typeName,
        description:
          `Part of your commitment: ${o.commitmentTitle}\n\n` +
          `This prickle isn't on the schedule yet, so the time may change.\n\n${origin}/my-prickles?tab=commitments`,
        status: "TENTATIVE",
        reminderMinutes: FEED_REMINDER_MINUTES,
      });
    }
  }

  for (const p of added) {
    const start = new Date(p.startTime);
    const key = prickleKey(p.id);
    if (events.has(key)) continue; // hosting or committed
    events.set(key, {
      uid: uid(key),
      start,
      end: new Date(p.endTime),
      summary: p.hostName ? `${p.typeName} with ${hostShortName(p.hostName)}` : p.typeName,
      description: `Added from Hedgie Hub.\n\n${prickleUrl(p.id)}`,
      url: prickleUrl(p.id),
      reminderMinutes: FEED_REMINDER_MINUTES,
    });
  }

  for (const e of addedEvents) {
    const key = `event-${e.id}`;
    const url = `${origin}/events/${e.slug}`;
    events.set(key, {
      uid: uid(key),
      start: new Date(`${e.startsAt}T00:00:00Z`),
      end: new Date(new Date(`${e.endsAt}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000),
      allDay: true,
      summary: e.title,
      description: `Added from Hedgie Hub.\n\n${url}`,
      location: e.location ?? undefined,
      url,
    });
  }

  return [...events.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

type NameRef = { name: string } | { name: string }[] | null;

function nameOf(ref: NameRef): string | null {
  const row = Array.isArray(ref) ? ref[0] : ref;
  return row?.name ?? null;
}

interface PrickleRow {
  id: string;
  type_id: string | null;
  start_time: string;
  end_time: string;
  prickle_types: NameRef;
  host?: NameRef;
}

function toFeedPrickle(row: PrickleRow): FeedPrickle {
  return {
    id: row.id,
    typeId: row.type_id,
    typeName: nameOf(row.prickle_types) ?? "Prickle",
    hostName: nameOf(row.host ?? null),
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

interface CommitmentRow {
  id: string;
  start_date: string;
  weeks: number;
  status: CommitmentStatus;
  cancelled_at: string | null;
  prickle_commitment_slots: {
    type_id: string;
    day_of_week: number;
    start_time_local: string;
    timezone: string;
    prickle_types: NameRef;
  }[];
}

/**
 * Load one member's feed events. `supabase` is the service-role client (the feed has no session),
 * so every query here is scoped to `memberId`. Paginated per CLAUDE.md.
 */
export async function loadCalendarFeedEvents(
  supabase: SupabaseClient,
  memberId: string,
  origin: string,
  now: Date = new Date()
): Promise<ICalEvent[]> {
  const since = new Date(now.getTime() - FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Added items don't depend on hosting or commitments: start them now, collect them at the end.
  const addedPromise = loadAddedItems(supabase, memberId, since);
  // Keep a rejection from going unhandled while the steps below run; it's rethrown at the await.
  addedPromise.catch(() => {});

  const [hostedRows, { data: commitmentData, error: commitmentError }] = await Promise.all([
    fetchAllRows<PrickleRow>((from, to) =>
      supabase
        .from("prickles")
        .select("id, type_id, start_time, end_time, prickle_types(name)")
        .eq("host", memberId)
        .gte("start_time", since.toISOString())
        .order("start_time")
        .order("id")
        .range(from, to)
    ),
    supabase
      .from("prickle_commitments")
      .select(
        "id, start_date, weeks, status, cancelled_at, prickle_commitment_slots(type_id, day_of_week, start_time_local, timezone, prickle_types(name))"
      )
      .eq("member_id", memberId)
      .gte("end_date", since.toISOString().slice(0, 10)),
  ]);
  if (commitmentError) throw new Error(commitmentError.message);

  const commitmentRows = ((commitmentData ?? []) as unknown as CommitmentRow[]).filter(
    (r) => (r.prickle_commitment_slots ?? []).length > 0
  );
  const commitments: Commitment[] = commitmentRows.map((r) => ({
    id: r.id,
    startDate: r.start_date,
    weeks: r.weeks,
    status: r.status,
    cancelledAt: r.cancelled_at,
    slots: r.prickle_commitment_slots.map(
      (s): CommitmentSlot => ({
        typeId: s.type_id,
        dayOfWeek: s.day_of_week,
        startTimeLocal: s.start_time_local,
        timezone: s.timezone,
      })
    ),
  }));

  const committed: CommittedOccurrence[] = [];
  const window = commitmentsFetchWindow(commitments);
  if (window) {
    const typeIds = [...new Set(commitments.flatMap((c) => c.slots.map((s) => s.typeId)))];
    const prickles = (
      await fetchAllRows<PrickleRow>((from, to) =>
        supabase
          .from("prickles")
          .select(PRICKLE_DETAIL_SELECT)
          .in("type_id", typeIds)
          .gte("start_time", window.from)
          .lte("start_time", window.to)
          .order("start_time")
          .order("id")
          .range(from, to)
      )
    ).map(toFeedPrickle);
    const byId = new Map(prickles.map((p) => [p.id, p]));
    const slotPrickles: SlotPrickle[] = prickles.map((p) => ({
      id: p.id,
      typeId: p.typeId,
      startTime: p.startTime,
      endTime: p.endTime,
    }));

    commitments.forEach((c, i) => {
      const slotNames = commitmentRows[i].prickle_commitment_slots.map((s) => nameOf(s.prickle_types) ?? "Prickle");
      const title = formatCommitmentTitle(c.slots.map((s, j) => ({ ...s, typeName: slotNames[j] })));
      // Attendance doesn't matter here (only which prickle each occurrence is), so no attended set.
      const { occurrences } = computeCommitmentProgress(c, slotPrickles, new Set(), now);
      for (const o of occurrences) {
        const prickle = o.prickleId ? byId.get(o.prickleId) ?? null : null;
        const start = new Date(prickle?.startTime ?? o.expectedStart);
        // Keep matched prickles back to the lookback; unscheduled ones only while still ahead.
        if (prickle ? start < since : start <= now) continue;
        committed.push({
          prickle,
          typeId: c.slots[o.slotIndex].typeId,
          typeName: slotNames[o.slotIndex],
          expectedStart: o.expectedStart,
          commitmentTitle: title,
        });
      }
    });
  }

  const { added, events } = await addedPromise;

  return buildCalendarFeedEvents({
    memberId,
    origin,
    hosted: hostedRows.map(toFeedPrickle),
    committed,
    added,
    events,
  });
}

interface FeedItemRow {
  kind: "prickle" | "slot" | "event";
  prickle_id: string | null;
  type_id: string | null;
  day_of_week: number | null;
  start_time_local: string | null;
  timezone: string | null;
  event_id: string | null;
}

/** Ids per .in() request -- keeps the URL short (a member adds a handful, but stay safe). */
const ID_BATCH_SIZE = 100;
const PRICKLE_DETAIL_SELECT = "id, type_id, start_time, end_time, prickle_types(name), host:members(name)";

/**
 * calendar_feed_items resolved to prickles and events. A 'prickle' item is that prickle (its row
 * cascades away if the prickle is deleted); a 'slot' item is every prickle on that slot from
 * `since` on.
 */
async function loadAddedItems(
  supabase: SupabaseClient,
  memberId: string,
  since: Date
): Promise<{ added: FeedPrickle[]; events: FeedEventRow[] }> {
  const { data, error } = await supabase
    .from("calendar_feed_items")
    .select("kind, prickle_id, type_id, day_of_week, start_time_local, timezone, event_id")
    .eq("member_id", memberId);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as FeedItemRow[];

  const prickleIds = items.filter((i) => i.kind === "prickle").map((i) => i.prickle_id!);
  const slots: CommitmentSlot[] = items
    .filter((i) => i.kind === "slot")
    .map((i) => ({ typeId: i.type_id!, dayOfWeek: i.day_of_week!, startTimeLocal: i.start_time_local!, timezone: i.timezone! }));
  const eventIds = items.filter((i) => i.kind === "event").map((i) => i.event_id!);

  // The three lookups are independent, so they run in parallel (one round trip, not three).
  const loadOnce = async (): Promise<FeedPrickle[]> => {
    const batches = await Promise.all(
      chunk(prickleIds, ID_BATCH_SIZE).map(async (ids) => {
        const { data: rows, error: prickleError } = await supabase
          .from("prickles")
          .select(PRICKLE_DETAIL_SELECT)
          .in("id", ids)
          .gte("start_time", since.toISOString());
        if (prickleError) throw new Error(prickleError.message);
        return ((rows ?? []) as PrickleRow[]).map(toFeedPrickle);
      })
    );
    return batches.flat();
  };

  const loadWeekly = async (): Promise<FeedPrickle[]> => {
    if (slots.length === 0) return [];
    const typeIds = [...new Set(slots.map((s) => s.typeId))];
    const candidates = (
      await fetchAllRows<PrickleRow>((from, to) =>
        supabase
          .from("prickles")
          .select(PRICKLE_DETAIL_SELECT)
          .in("type_id", typeIds)
          .gte("start_time", since.toISOString())
          .order("start_time")
          .order("id")
          .range(from, to)
      )
    ).map(toFeedPrickle);
    return candidates.filter((p) => slots.some((slot) => prickleMatchesSlot(p, slot)));
  };

  const loadEvents = async (): Promise<FeedEventRow[]> => {
    if (eventIds.length === 0) return [];
    const { data: eventRows, error: eventError } = await supabase
      .from("events")
      .select("id, slug, title, location, starts_at, ends_at")
      .in("id", eventIds)
      .gte("ends_at", since.toISOString().slice(0, 10));
    if (eventError) throw new Error(eventError.message);
    return (eventRows ?? []).map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      location: e.location,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
    }));
  };

  const [once, weekly, events] = await Promise.all([loadOnce(), loadWeekly(), loadEvents()]);
  return { added: [...once, ...weekly], events };
}
