import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";
import { CALENDAR_LIST_PAGE_SIZE, elevateCalendarEvent, type CalendarListFilter, type CalendarListItem } from "@/lib/calendar-events";
import { isUuid } from "@/lib/ids";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit. */
const ID_CHUNK = 100;

/**
 * Upcoming items on the shared calendar, soonest first, with what each is: a prickle (and its type),
 * waiting for a type, and whether it is shown in Events. `filter=in_events` lists just those shown.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const params = request.nextUrl.searchParams;
  const filter: CalendarListFilter = params.get("filter") === "in_events" ? "in_events" : "upcoming";
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10) || 0);
  const search = (params.get("q") ?? "").trim().replace(/[%,()]/g, " ");

  const columns = "id, summary, location, start_time, end_time";
  const now = new Date().toISOString();
  let rows: { id: string; summary: string | null; location: string | null; start_time: string; end_time: string }[];

  if (filter === "in_events") {
    // Page the events that follow a calendar item, then take the calendar rows for just that page.
    let linked = supabase
      .from("events")
      .select("calendar_event_id")
      .not("calendar_event_id", "is", null)
      .gte("end_time", now)
      .order("start_time")
      .order("id");
    if (search) linked = linked.ilike("title", `%${search}%`);
    const { data: linkedPage, error: linkedError } = await linked.range(offset, offset + CALENDAR_LIST_PAGE_SIZE);
    if (linkedError) return NextResponse.json({ error: linkedError.message }, { status: 500 });
    const pageIds = (linkedPage ?? []).map((e) => e.calendar_event_id as string);
    const { data, error } = pageIds.length
      ? await supabase.schema("bronze").from("calendar_events").select(columns).in("id", pageIds).order("start_time").order("id")
      : { data: [], error: null };
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = data ?? [];
  } else {
    let query = supabase.schema("bronze").from("calendar_events").select(columns).gte("end_time", now).order("start_time").order("id");
    if (search) query = query.ilike("summary", `%${search}%`);
    const { data, error } = await query.range(offset, offset + CALENDAR_LIST_PAGE_SIZE);
    if (error) {
      console.error("Error listing calendar events:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows = data ?? [];
  }

  const hasMore = rows.length > CALENDAR_LIST_PAGE_SIZE;
  const shown = rows.slice(0, CALENDAR_LIST_PAGE_SIZE);
  const ids = shown.map((r) => r.id);

  const prickleTypes = new Map<string, string | null>();
  const pending = new Set<string>();
  const events = new Map<string, { id: string; slug: string }>();
  const repos = createRepos(supabase);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const [prickles, unmatched, linkedEvents] = await Promise.all([
      repos.prickles.byCalendarEventIds(chunk),
      supabase.from("unmatched_calendar_events").select("calendar_event_id").in("calendar_event_id", chunk).eq("status", "pending"),
      supabase.from("events").select("id, slug, calendar_event_id").in("calendar_event_id", chunk),
    ]);
    if (unmatched.error) return NextResponse.json({ error: unmatched.error.message }, { status: 500 });
    if (linkedEvents.error) return NextResponse.json({ error: linkedEvents.error.message }, { status: 500 });
    for (const p of prickles) if (p.calendarEventId) prickleTypes.set(p.calendarEventId, p.type?.name ?? null);
    for (const u of unmatched.data ?? []) pending.add(u.calendar_event_id);
    for (const e of linkedEvents.data ?? []) events.set(e.calendar_event_id as string, { id: e.id, slug: e.slug });
  }

  const items: CalendarListItem[] = shown.map((r) => ({
    ...r,
    prickleType: prickleTypes.get(r.id) ?? null,
    needsType: pending.has(r.id),
    event: events.get(r.id) ?? null,
  }));
  return NextResponse.json({ items, hasMore });
}

/** Shows a calendar item in Events: creates the event that follows it, or returns the one it has. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!isUuid(body.calendarEventId)) return NextResponse.json({ error: "calendarEventId is required" }, { status: 400 });

  const result = await elevateCalendarEvent(supabase, body.calendarEventId, user.id === "service-role" || user.id === "cron" ? null : user.id);
  if (!result.ok) {
    if (result.status === 500) console.error("Error showing a calendar event in Events:", result.error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ event: result.event }, { status: result.created ? 201 : 200 });
}
