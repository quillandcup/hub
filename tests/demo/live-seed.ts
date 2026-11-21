/**
 * The demo's live states, laid relative to NOW so a screenshot can show a prickle that is running, people in the Zoom
 * room and a lapsed streak. Everything is fictional and deterministic; each run replaces what the last one wrote.
 *
 * What expires: the live prickle started 20 minutes ago and ends in 40, and the room's participants have no "left" event,
 * so the on-air light and the running prickle last about 40 minutes (the room itself would stay lit up to 12 hours, but the
 * prickle would be gone). Run `pnpm demo:seed` right before capturing, and capture within the hour.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/config";
import type { ZoomAttendeeRow } from "./attendance";
import { DEMO_TOPIC_PREFIX } from "./attendance";

const MINUTE = 60_000;

export const LIVE_EVENT_KEY = "live-now";
export const LIVE_MEETING_UUID = "demo-mtg-live-now";
export const LIVE_HOST_ID = "demo-zoom-host";
export const LIVE_SUMMARY = "Progress Prickle w/Hazel Hosting";

/** The series whose streak lapses for the demo member: Plot or Plan on Thursday evenings. */
export const LAPSED_SERIES = { summaryPrefix: "Plot or Plan Prickle", weekday: 4, hour: 19 } as const;

/** Names in the room (a guest too): all fictional, matched to demo members by name and email like the real webhook is. */
export const LIVE_ROOM = [
  { name: "Hazel Hosting", email: "hazel.hosting@example.com", minutesAgo: 22 },
  { name: "Julia Sample", email: "julia.sample@example.com", minutesAgo: 19 },
  { name: "Rosa Demo", email: "rosa.demo@example.com", minutesAgo: 17 },
  { name: "Nell Newcomer", email: "nell.newcomer@example.com", minutesAgo: 12 },
  { name: "A guest", email: "", minutesAgo: 9 },
] as const;

/** The calendar event for the prickle running now, as the importer would have stored it. */
export function liveCalendarEvent(now: Date) {
  const start = new Date(now.getTime() - 20 * MINUTE);
  return {
    google_event_id: `demo-${LIVE_EVENT_KEY}`,
    summary: LIVE_SUMMARY,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 60 * MINUTE).toISOString(),
    raw_data: { demo: true },
  };
}

/** The Zoom meeting and joined events for the people in the room. No "left" events: they are still there. */
export function liveRoomRows(now: Date) {
  const meeting = {
    meeting_uuid: LIVE_MEETING_UUID,
    meeting_id: "0000000000",
    topic: `${DEMO_TOPIC_PREFIX} ${LIVE_SUMMARY}`,
    start_time: new Date(now.getTime() - 22 * MINUTE).toISOString(),
    host_name: "Hazel Hosting",
    data: { demo: true, host_id: LIVE_HOST_ID },
  };
  const events = LIVE_ROOM.map((p, i) => ({
    meeting_uuid: LIVE_MEETING_UUID,
    meeting_id: "0000000000",
    host_id: LIVE_HOST_ID,
    event: "joined" as const,
    participant_key: `demo-live-${i}`,
    participant_name: p.name,
    participant_email: p.email || null,
    event_time: new Date(now.getTime() - p.minutesAgo * MINUTE).toISOString(),
    raw_payload: { demo: true },
  }));
  return { meeting, events };
}

function localParts(date: Date): { weekday: number; hour: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const utcDay = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))) / 86_400_000;
  return { weekday, hour: Number(get("hour")) % 24, day: utcDay };
}

/** Whole Monday-based weeks between the week of `date` and the week of `now`, in the org's timezone (the streaks' own week). */
export function weeksBefore(date: Date, now: Date): number {
  const monday = (d: Date) => {
    const p = localParts(d);
    return p.day - ((p.weekday + 6) % 7);
  };
  return Math.round((monday(now) - monday(date)) / 7);
}

interface Slot {
  key: string;
  summary: string;
  start: Date;
  end: Date;
}

/**
 * Makes the demo member's streak on the Thursday Plot or Plan series lapsed: she came two weeks in a row, three and two
 * weeks ago, and has not been since. Her other rows for that series are dropped (the hash may have had her there last week),
 * and the two attended occurrences are added whole (before the end of the prickle, in one stretch).
 */
export function withLapsedStreak(rows: ZoomAttendeeRow[], slots: Slot[], person: { name: string; email: string }, now: Date): ZoomAttendeeRow[] {
  const inSeries = (s: Slot) => {
    const p = localParts(s.start);
    return s.summary.startsWith(LAPSED_SERIES.summaryPrefix) && p.weekday === LAPSED_SERIES.weekday && p.hour === LAPSED_SERIES.hour;
  };
  const seriesKeys = new Set(slots.filter(inSeries).map((s) => `demo-mtg-${s.key}`));
  const kept = rows.filter((r) => !(r.email === person.email && seriesKeys.has(r.meeting_uuid)));
  const added = slots
    .filter((s) => inSeries(s) && [3, 2].includes(weeksBefore(s.start, now)) && s.end.getTime() <= now.getTime())
    .map((s): ZoomAttendeeRow => {
      const join = new Date(s.start.getTime() + 2 * MINUTE);
      const leave = new Date(s.end.getTime() + MINUTE);
      return {
        meeting_id: "0000000000",
        meeting_uuid: `demo-mtg-${s.key}`,
        topic: `${DEMO_TOPIC_PREFIX} ${s.summary}`,
        participant_id: `demo-${person.email}`,
        name: person.name,
        email: person.email,
        join_time: join.toISOString(),
        leave_time: leave.toISOString(),
        duration: Math.round((leave.getTime() - join.getTime()) / 1000),
        status: "in_meeting",
        raw_payload: { demo: true },
      };
    });
  return [...kept, ...added];
}

/** Replaces the room's Zoom rows (a meeting whose host the attendance import covers, and who joined). */
export async function seedLiveRoom(admin: SupabaseClient, now: Date) {
  const { meeting, events } = liveRoomRows(now);
  const bronze = admin.schema("bronze");
  const { error: meetingError } = await bronze.from("zoom_meetings").upsert(meeting, { onConflict: "meeting_uuid" });
  if (meetingError) throw new Error(`zoom_meetings (live): ${meetingError.message}`);
  const { error: clearError } = await bronze.from("zoom_participant_events").delete().eq("meeting_uuid", LIVE_MEETING_UUID);
  if (clearError) throw new Error(`zoom_participant_events clear: ${clearError.message}`);
  const { error } = await bronze.from("zoom_participant_events").insert(events);
  if (error) throw new Error(`zoom_participant_events: ${error.message}`);
}

/** Puts the running prickle on the member's calendar, so check-in is offered. Needs the prickle to exist (after processing). */
export async function addLivePrickleToCalendar(admin: SupabaseClient, memberId: string) {
  const { data: event, error: eventError } = await admin.schema("bronze").from("calendar_events").select("id").eq("google_event_id", `demo-${LIVE_EVENT_KEY}`).maybeSingle();
  if (eventError) throw new Error(`live calendar event: ${eventError.message}`);
  if (!event) return;
  const { data: prickle, error } = await admin.from("prickles").select("id").eq("calendar_event_id", event.id).maybeSingle();
  if (error) throw new Error(`live prickle: ${error.message}`);
  if (!prickle) return;
  const { error: addError } = await admin.from("calendar_feed_items").insert({ member_id: memberId, kind: "prickle", prickle_id: prickle.id });
  if (addError && addError.code !== "23505") throw new Error(`calendar_feed_items (live): ${addError.message}`);
}
