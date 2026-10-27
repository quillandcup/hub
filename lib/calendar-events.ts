import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { ORG_TIMEZONE } from "@/lib/config";
import { plainTextDescription } from "@/lib/prickle-types";

// Events that follow the shared Google calendar (events.calendar_event_id). A calendar item shown
// in Events gets an events row; its title, description and location follow the calendar until an
// admin changes them, and a changed field is recorded in overridden_fields so the sync leaves it.

export const OVERRIDABLE_FIELDS = ["title", "description", "location"] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export function isOverridableField(value: unknown): value is OverridableField {
  return typeof value === "string" && (OVERRIDABLE_FIELDS as readonly string[]).includes(value);
}

/** The tag that, in a Google Calendar event's description, shows the event in Events: "#event". */
const EVENT_TAG = /(^|[\s>(])#event\b/gi;

/** Whether the description carries the #event tag. "#events" and "#eventful" don't count. */
export function hasEventTag(description: string | null | undefined): boolean {
  if (!description) return false;
  EVENT_TAG.lastIndex = 0;
  return EVENT_TAG.test(description);
}

/** The plain-text description with the #event tag taken out (it is an instruction, not something to show). */
export function descriptionWithoutEventTag(description: string | null | undefined): string | null {
  const plain = plainTextDescription(description);
  if (!plain) return null;
  const cleaned = plain
    .replace(EVENT_TAG, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || null;
}

/** The Bronze calendar event columns an events row is built from. */
export interface CalendarSource {
  summary: string | null;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
}

export interface CalendarEventFields {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  start_time: string;
  end_time: string;
}

/** YYYY-MM-DD of an instant in the organization's timezone (the day Quill & Cup calls it). */
export function orgDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** A calendar summary without its "w/Host" tail and wrapping quotes: "Query Letters w/Sam" -> "Query Letters". */
export function calendarTitle(summary: string | null): string {
  const cleaned = (summary ?? "")
    .replace(/^['"](.+?)['"]$/, "$1")
    .replace(/\s*\bw\/\s*.+$/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
  return cleaned || "Untitled event";
}

/** What an events row holds for a calendar item. An event that ends exactly at midnight ends the day before. */
export function calendarEventFields(source: CalendarSource): CalendarEventFields {
  const start = new Date(source.start_time).getTime();
  const lastMinute = Math.max(start, new Date(source.end_time).getTime() - 60_000);
  return {
    title: calendarTitle(source.summary),
    description: descriptionWithoutEventTag(source.description),
    location: source.location?.trim() || null,
    starts_at: orgDate(source.start_time),
    ends_at: orgDate(new Date(lastMinute).toISOString()),
    start_time: source.start_time,
    end_time: source.end_time,
  };
}

/**
 * The columns a calendar sync may write to an existing row: the dates and times always, and each of
 * title, description and location unless an admin overrode it.
 */
export function syncableFields(fields: CalendarEventFields, overridden: readonly string[]): Partial<CalendarEventFields> {
  const { title, description, location, ...always } = fields;
  const out: Partial<CalendarEventFields> = { ...always };
  if (!overridden.includes("title")) out.title = title;
  if (!overridden.includes("description")) out.description = description;
  if (!overridden.includes("location")) out.location = location;
  return out;
}

/**
 * Which of title, description and location an update changes from what the row holds now, merged into
 * the fields already overridden. Only a real change counts, so saving a form that sends every field
 * doesn't override the ones left alone.
 */
export function overriddenAfterEdit(
  current: Record<OverridableField, string | null> & { overridden_fields: readonly string[] },
  edit: Partial<Record<OverridableField, string | null>>,
): string[] {
  const next = new Set(current.overridden_fields);
  for (const field of OVERRIDABLE_FIELDS) {
    if (edit[field] !== undefined && (edit[field] || null) !== (current[field] || null)) next.add(field);
  }
  return [...next].sort();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type Db = SupabaseClient<Database>;

export type ElevateResult =
  | { ok: true; created: boolean; event: { id: string; slug: string; hidden: boolean } }
  | { ok: false; status: 404 | 500; error: string };

/**
 * Shows a calendar item in Events: creates the events row that follows it (or returns the one it
 * already has). Its slug is the title and date, with a numeric suffix if another event has it.
 */
export async function elevateCalendarEvent(db: Db, calendarEventId: string, userId: string | null): Promise<ElevateResult> {
  const existingEvent = async () => {
    const { data, error } = await db.from("events").select("id, slug, deleted_at").eq("calendar_event_id", calendarEventId).maybeSingle();
    return { error, event: data ? { id: data.id, slug: data.slug, hidden: !!data.deleted_at } : null };
  };
  const existing = await existingEvent();
  if (existing.error) return { ok: false, status: 500, error: existing.error.message };
  if (existing.event) return { ok: true, created: false, event: existing.event };

  const { data: source, error: sourceError } = await db
    .schema("bronze")
    .from("calendar_events")
    .select("summary, description, location, start_time, end_time")
    .eq("id", calendarEventId)
    .maybeSingle();
  if (sourceError) return { ok: false, status: 500, error: sourceError.message };
  if (!source) return { ok: false, status: 404, error: "Calendar event not found" };

  const fields = calendarEventFields(source);
  const base = `${slugify(fields.title)}-${fields.starts_at}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const { data, error } = await db
      .from("events")
      .insert({ ...fields, slug, event_type: "other", calendar_event_id: calendarEventId, created_by: userId })
      .select("id, slug")
      .single();
    if (!error) return { ok: true, created: true, event: { ...data, hidden: false } };
    if (error.code === "23505" && error.message.includes("calendar_event_id")) {
      // Someone showed it a moment ago; return theirs.
      const theirs = await existingEvent();
      if (theirs.event) return { ok: true, created: false, event: theirs.event };
    }
    if (error.code !== "23505") return { ok: false, status: 500, error: error.message };
  }
  return { ok: false, status: 500, error: "Could not find a free address for this event" };
}

/**
 * Makes sure each of these calendar events has an event, creating the ones that don't (a hidden event
 * counts as having one, so it stays hidden). Used by the calendar sync for items of prickle types listed
 * in Events, so a recurring session needs no click. Returns how many it created.
 */
export async function ensureCalendarEvents(db: Db, calendarEventIds: string[]): Promise<number> {
  if (calendarEventIds.length === 0) return 0;

  const have = new Set<string>();
  for (let i = 0; i < calendarEventIds.length; i += 100) {
    const { data, error } = await db.from("events").select("calendar_event_id").in("calendar_event_id", calendarEventIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.calendar_event_id) have.add(row.calendar_event_id);
  }
  const missing = calendarEventIds.filter((id) => !have.has(id));

  let created = 0;
  for (let i = 0; i < missing.length; i += 10) {
    const results = await Promise.all(missing.slice(i, i + 10).map((id) => elevateCalendarEvent(db, id, null)));
    for (const result of results) {
      if (!result.ok) throw new Error(result.error);
      if (result.created) created++;
    }
  }
  return created;
}

/**
 * After the calendar is processed: brings every events row that follows one of these calendar events
 * up to date (dates and times, and each field not overridden). Rows are updated in parallel batches.
 */
export async function syncCalendarEvents(db: Db, sources: ({ id: string } & CalendarSource)[]): Promise<number> {
  if (sources.length === 0) return 0;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ids = [...byId.keys()];

  const linked: { id: string; calendar_event_id: string | null; overridden_fields: string[] }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("events").select("id, calendar_event_id, overridden_fields").in("calendar_event_id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    linked.push(...(data ?? []));
  }

  let updated = 0;
  for (let i = 0; i < linked.length; i += 25) {
    const results = await Promise.all(
      linked.slice(i, i + 25).map(async (row) => {
        const source = byId.get(row.calendar_event_id as string);
        if (!source) return false;
        const { error } = await db.from("events").update(syncableFields(calendarEventFields(source), row.overridden_fields)).eq("id", row.id);
        if (error) throw new Error(error.message);
        return true;
      }),
    );
    updated += results.filter(Boolean).length;
  }
  return updated;
}

/** Rows the admin calendar list shows per page. */
export const CALENDAR_LIST_PAGE_SIZE = 50;

export type CalendarListFilter = "upcoming" | "in_events";

/** One item on the admin calendar list (/api/admin/events/calendar). */
export interface CalendarListItem {
  id: string;
  summary: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  /** The prickle type name, when the item is a prickle. */
  prickleType: string | null;
  /** Waiting in the unmatched-events queue for a type. */
  needsType: boolean;
  /** The events row that follows it, when it is shown in Events. */
  event: { id: string; slug: string; hidden: boolean } | null;
}
