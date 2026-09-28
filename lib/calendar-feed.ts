import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignOccurrencePrickles,
  commitmentsFetchWindow,
  computeCommitmentProgress,
  formatCommitmentTitle,
  MATCH_TOLERANCE_MINUTES,
  prickleMatchesSlot,
  type Commitment,
  type CommitmentSlot,
  type CommitmentStatus,
  type SlotPrickle,
} from "@/lib/commitments";
import { hostShortName } from "@/lib/formatters";
import { formatUtc, type ICalEvent } from "@/lib/ical";
import { fetchAllRows } from "@/lib/supabase/paginate";

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
const UID_DOMAIN = "hub.quillandcup.com";

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

/**
 * The timezone the prickle schedule is kept in (prickle_schedules.timezone defaults to it; prickles
 * repeat at a fixed wall-clock time here, across DST). "Every week" items are anchored to it rather
 * than to the member's own timezone: a slot defined in, say, Europe/London would stop matching for
 * the weeks when US and UK daylight saving start or end on different dates.
 */
export const SCHEDULE_TIMEZONE = "America/New_York";

/** An item the member added to their feed by hand (calendar_feed_items), as listed in the UI. */
export type MyCalendarItem =
  | { id: string; kind: "prickle"; label: string; typeId: string; startTime: string }
  | { id: string; kind: "slot"; label: string; slotKey: string }
  | { id: string; kind: "event"; label: string; eventId: string };

/** Which of the member's added items cover one prickle: just that occurrence, and/or its weekly slot. */
export interface PrickleCalendarState {
  onceItemId: string | null;
  weeklyItemId: string | null;
}

export function prickleCalendarState(
  items: readonly MyCalendarItem[],
  prickle: { typeId: string | null; startTime: string },
  weeklySlotKey: string | null
): PrickleCalendarState {
  const startMs = new Date(prickle.startTime).getTime();
  let onceItemId: string | null = null;
  let weeklyItemId: string | null = null;
  for (const item of items) {
    if (item.kind === "prickle" && item.typeId === prickle.typeId && new Date(item.startTime).getTime() === startMs) {
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

function eventKey(typeId: string | null, start: Date): string {
  return `${typeId ?? "untyped"}-${formatUtc(start)}`;
}

/**
 * Hosted prickles, committed occurrences, and added prickles and events as calendar events, one
 * per prickle: a prickle that qualifies more than once shows once, as hosting, else as committed,
 * else as added. UIDs come from the prickle's type and
 * start time (plus the member), not its id -- prickles are DELETE+INSERT reprocessed, so their ids
 * change, and a changing UID would make calendar apps drop and re-add the event.
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
    const key = eventKey(p.typeId, start);
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
      const key = eventKey(p.typeId, start);
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
      const key = eventKey(o.typeId, start);
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
    const key = eventKey(p.typeId, start);
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

  const { added, events } = await loadAddedItems(supabase, memberId, since);

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
  type_id: string | null;
  start_time: string | null;
  day_of_week: number | null;
  start_time_local: string | null;
  timezone: string | null;
  event_id: string | null;
}

const PRICKLE_DETAIL_SELECT = "id, type_id, start_time, end_time, prickle_types(name), host:members(name)";

/**
 * calendar_feed_items resolved to prickles and events. A 'prickle' item is its closest same-type
 * prickle within the commitment match tolerance (reprocessing can nudge a time); one that no
 * longer matches anything was cancelled or moved, and drops out. A 'slot' item is every prickle
 * on that slot from `since` on.
 */
async function loadAddedItems(
  supabase: SupabaseClient,
  memberId: string,
  since: Date
): Promise<{ added: FeedPrickle[]; events: FeedEventRow[] }> {
  const { data, error } = await supabase
    .from("calendar_feed_items")
    .select("kind, type_id, start_time, day_of_week, start_time_local, timezone, event_id")
    .eq("member_id", memberId);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as FeedItemRow[];

  const toleranceMs = MATCH_TOLERANCE_MINUTES * 60 * 1000;
  const onceItems = items.filter((i) => i.kind === "prickle" && new Date(i.start_time!).getTime() + toleranceMs >= since.getTime());
  const slots: CommitmentSlot[] = items
    .filter((i) => i.kind === "slot")
    .map((i) => ({ typeId: i.type_id!, dayOfWeek: i.day_of_week!, startTimeLocal: i.start_time_local!, timezone: i.timezone! }));
  const eventIds = items.filter((i) => i.kind === "event").map((i) => i.event_id!);

  const added: FeedPrickle[] = [];

  if (onceItems.length > 0) {
    const starts = onceItems.map((i) => new Date(i.start_time!).getTime());
    const typeIds = [...new Set(onceItems.map((i) => i.type_id!))];
    const candidates = (
      await fetchAllRows<PrickleRow>((from, to) =>
        supabase
          .from("prickles")
          .select(PRICKLE_DETAIL_SELECT)
          .in("type_id", typeIds)
          .gte("start_time", new Date(Math.min(...starts) - toleranceMs).toISOString())
          .lte("start_time", new Date(Math.max(...starts) + toleranceMs).toISOString())
          .order("start_time")
          .order("id")
          .range(from, to)
      )
    ).map(toFeedPrickle);
    const matches = assignOccurrencePrickles(
      onceItems.map((i) => ({ typeId: i.type_id!, start: new Date(i.start_time!) })),
      candidates.map((p) => ({ id: p.id, typeId: p.typeId, startTime: p.startTime, endTime: p.endTime }))
    );
    const byId = new Map(candidates.map((p) => [p.id, p]));
    for (const m of matches) {
      const p = m ? byId.get(m.id) : undefined;
      if (p && new Date(p.startTime) >= since) added.push(p);
    }
  }

  if (slots.length > 0) {
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
    for (const p of candidates) {
      if (slots.some((slot) => prickleMatchesSlot(p, slot))) added.push(p);
    }
  }

  let events: FeedEventRow[] = [];
  if (eventIds.length > 0) {
    const { data: eventRows, error: eventError } = await supabase
      .from("events")
      .select("id, slug, title, location, starts_at, ends_at")
      .in("id", eventIds)
      .gte("ends_at", since.toISOString().slice(0, 10));
    if (eventError) throw new Error(eventError.message);
    events = (eventRows ?? []).map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      location: e.location,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
    }));
  }

  return { added, events };
}
