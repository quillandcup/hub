import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { ORG_TIMEZONE } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { normalizePrickleType, parsePrickleFromSummary, plainTextDescription, typeIdByAlias } from "@/lib/prickle-types";

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

/** "Quill & Cup" (or "Q&C", with or without "Prickle") before a "[Category]" or a colon is the organization's label on the item, not part of its title. */
const ORG_LABEL = /^(?:quill\s*&\s*cup|q\s*&\s*c)\s*(?:prickle\s*)?(?=[\[:])/i;

/**
 * What a calendar summary says besides the host: the title, with the organization's label, the "[Category]" and a
 * "Prickle:" or ":" label taken off, and the category. "Quill & Cup [Authorpreneurship] Prickle: A Way to Make
 * Money with Sam" -> { title: "A Way to Make Money", category: "Authorpreneurship" }. The host or guest ("w/Sam",
 * "with Sam") is not part of the title. A name that is only an organization label ("Quill & Cup Challenge") is left alone.
 */
function splitCalendarSummary(summary: string | null): { title: string; category: string | null } {
  const { type } = parsePrickleFromSummary(summary ?? "");
  const named = type && !/^w\//i.test(type) ? type.trim() : "";
  const withoutOrg = named.replace(ORG_LABEL, "").trim();
  const bracket = withoutOrg.match(/^\[([^\]]+)\]\s*/);
  const category = bracket ? bracket[1].trim() || null : null;
  const title = (bracket ? withoutOrg.slice(bracket[0].length) : withoutOrg)
    .replace(/^prickle\s*:\s*/i, "")
    .replace(/^:\s*/, "")
    .trim();
  return { title: title || category || named, category };
}

/** The title of an event made from a calendar summary: "Quill & Cup [Category] Prickle: Title with Sam" -> "Title". */
export function calendarTitle(summary: string | null): string {
  return splitCalendarSummary(summary).title || "Untitled event";
}

/** The "[Category]" of a calendar summary ("Authorpreneurship", "Challenge"), or null. */
export function calendarCategory(summary: string | null): string | null {
  return splitCalendarSummary(summary).category;
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
 * What an edit of title, description and location does to the overrides: a field the edit leaves empty
 * follows the calendar (`follow`: no override, and the caller copies the calendar's value in), a field
 * given text that differs from what the row holds is overridden, and anything else is left as it was.
 * Only a real change counts, so saving a form that sends every field doesn't override the ones left alone.
 */
export function overridesAfterEdit(
  current: Record<OverridableField, string | null> & { overridden_fields: readonly string[] },
  edit: Partial<Record<OverridableField, string | null>>,
): { overridden: string[]; follow: OverridableField[] } {
  const overridden = new Set(current.overridden_fields);
  const follow: OverridableField[] = [];
  for (const field of OVERRIDABLE_FIELDS) {
    const value = edit[field];
    if (value === undefined) continue;
    if (!value || !value.trim()) {
      overridden.delete(field);
      follow.push(field);
    } else if (value !== current[field]) {
      overridden.add(field);
    }
  }
  return { overridden: [...overridden].sort(), follow };
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
export async function elevateCalendarEvent(db: Db, calendarEventId: string, userId: string | null, automatic = false): Promise<ElevateResult> {
  const existingEvent = async () => {
    const { data, error } = await db.from("events").select("id, slug, deleted_at, automatic").eq("calendar_event_id", calendarEventId).maybeSingle();
    return { error, event: data ? { id: data.id, slug: data.slug, hidden: !!data.deleted_at } : null, wasAutomatic: !!data?.automatic };
  };
  const existing = await existingEvent();
  if (existing.error) return { ok: false, status: 500, error: existing.error.message };
  if (existing.event) {
    // An admin showing an item the sync made by itself keeps it: the sync no longer takes it away.
    if (existing.wasAutomatic && !automatic) {
      const { error } = await db.from("events").update({ automatic: false }).eq("id", existing.event.id);
      if (error) return { ok: false, status: 500, error: error.message };
    }
    return { ok: true, created: false, event: existing.event };
  }

  const { data: source, error: sourceError } = await db
    .schema("bronze")
    .from("calendar_events")
    .select("summary, description, location, start_time, end_time")
    .eq("id", calendarEventId)
    .maybeSingle();
  if (sourceError) return { ok: false, status: 500, error: sourceError.message };
  if (!source) return { ok: false, status: 404, error: "Calendar event not found" };

  // The new event starts with its prickle type's audience (announced publicly, guests allowed), when it is a
  // prickle; an admin can change it on the event, e.g. to let guests into one educational session.
  // It also starts with the prickle's guest speaker, and the "[Category]" of the calendar title as its focus.
  const [prickle] = await createRepos(db).prickles.byCalendarEventIds([calendarEventId]);
  const audience = {
    announced_publicly: prickle?.type?.announcedPublicly ?? false,
    guests_allowed: prickle?.type?.guestsAllowed ?? false,
    speakers: prickle?.guestSpeaker ?? null,
    focus: calendarCategory(source.summary),
  };

  const fields = calendarEventFields(source);
  const base = `${slugify(fields.title)}-${fields.starts_at}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const { data, error } = await db
      .from("events")
      .insert({ ...fields, ...audience, slug, event_type: "other", calendar_event_id: calendarEventId, created_by: userId, automatic })
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
 * Makes sure each of these calendar events has an event, creating the ones that don't as automatic events
 * (a removed event counts as having one, so it stays removed). Used by the calendar sync for items of prickle
 * types listed in Events and items tagged #event, so a recurring session needs no click. Returns how many it created.
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
    const results = await Promise.all(missing.slice(i, i + 10).map((id) => elevateCalendarEvent(db, id, null, true)));
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

/**
 * After the calendar is processed: takes away the automatic events whose reason has stopped applying, so
 * the events follow the calendar and the prickle types both ways. These are the automatic events that follow
 * one of `sourceIds` (the calendar events just processed) but are not in `qualifying` (the ones that still
 * have a reason: a listed prickle type or an #event tag), and the automatic events whose calendar event is
 * gone. An event with photos, attendees or a badge is kept: it has been worked on, whatever made it.
 * Returns how many it removed.
 */
export async function reconcileAutomaticEvents(db: Db, sourceIds: string[], qualifying: ReadonlySet<string>): Promise<number> {
  const stale: string[] = [];

  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data, error } = await db
      .from("events")
      .select("id, calendar_event_id")
      .eq("automatic", true)
      .in("calendar_event_id", sourceIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.calendar_event_id && !qualifying.has(row.calendar_event_id)) stale.push(row.id);
  }
  // The calendar event is gone (the link was cleared when it was deleted), so nothing can make this event apply.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("events").select("id").eq("automatic", true).is("calendar_event_id", null).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    stale.push(...(data ?? []).map((r) => r.id));
    if ((data ?? []).length < 1000) break;
  }
  if (stale.length === 0) return 0;

  const worked = new Set<string>(await createRepos(db).badges.linkedEventIds());
  for (let i = 0; i < stale.length; i += 100) {
    const chunk = stale.slice(i, i + 100);
    const [photos, attendees] = await Promise.all([
      db.from("event_photos").select("event_id").in("event_id", chunk),
      db.from("event_attendees").select("event_id").in("event_id", chunk),
    ]);
    for (const result of [photos, attendees]) {
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) if (row.event_id) worked.add(row.event_id);
    }
  }
  const removable = stale.filter((id) => !worked.has(id));

  for (let i = 0; i < removable.length; i += 100) {
    const { error } = await db.from("events").delete().in("id", removable.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  return removable.length;
}

/** What the calendar sync needs of a prickle type to match a calendar title to it. */
export interface MatchableType {
  id: string;
  name: string;
  normalized_name: string;
  summary_aliases?: string[] | null;
}

/**
 * The prickle type a calendar title is for, or null. The type part of the title ("Heads Down Prickle w/Cody" ->
 * "Heads Down Prickle") is tried against the types' names and aliases, then the cleaned title ("Quill & Cup
 * [Mindset] Prickle: Get Your Spark Back!" -> "Get Your Spark Back", which is a type's name), then a type whose
 * name the title contains ("Midnight Open Table" contains "Open Table"). A title with no type, or just "Prickle",
 * is a Progress Prickle.
 */
export function matchTypeId(summary: string, types: MatchableType[]): string | null {
  const byName = new Map(types.map((t) => [t.normalized_name, t.id]));
  const { type: rawType } = parsePrickleFromSummary(summary);
  const normalizedType = rawType ? normalizePrickleType(rawType) : "";
  if (!normalizedType) return byName.get("progress") ?? null;

  const normalizedTitle = normalizePrickleType(calendarTitle(summary));
  const found =
    byName.get(normalizedType) ??
    (normalizedTitle ? byName.get(normalizedTitle) : undefined) ??
    typeIdByAlias(normalizedType, types) ??
    (normalizedTitle ? typeIdByAlias(normalizedTitle, types) : null);
  if (found) return found;

  const lower = summary.toLowerCase();
  return types.find((t) => lower.includes(t.name.toLowerCase()))?.id ?? null;
}
