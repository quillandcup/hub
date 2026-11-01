import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { ORG_TIMEZONE } from "@/lib/config";
import { prickleEventKind } from "@/lib/events-filter";
import { createRepos } from "@/lib/data/repos";
import { normalizePrickleType, parsePrickleFromSummary, plainTextDescription, typeIdByAlias } from "@/lib/prickle-types";

// An event stands on exactly one prickle (events.prickle_id); a calendar item shown in Events is the
// prickle made from it. Nothing is copied onto the event: title, description, location and times are
// read from the prickle, and an admin's edits live on the prickle (and in unmatched_calendar_events,
// which the calendar process applies on every run).

/** The tag that, in a Google Calendar event's description, shows the event in Events: "#event". */
const EVENT_TAG = /(^|[\s>(])#event\b/gi;

/** Whether the description carries the #event tag. "#events" and "#eventful" don't count. */
export function hasEventTag(description: string | null | undefined): boolean {
  if (!description) return false;
  EVENT_TAG.lastIndex = 0;
  return EVENT_TAG.test(description);
}

/** A calendar description (Google's HTML or plain text) as markdown with the #event tag taken out (it is an instruction, not something to show). */
export function descriptionWithoutEventTag(description: string | null | undefined): string | null {
  return stripEventTag(plainTextDescription(description));
}

/**
 * Markdown that is already converted (a prickle's description) with the #event tag taken out. It must not go
 * through the HTML conversion again: that would escape the markdown (`\*with\*`, `\[link\]`).
 */
export function stripEventTag(markdown: string | null | undefined): string | null {
  const plain = markdown?.trim();
  if (!plain) return null;
  const cleaned = plain
    .replace(EVENT_TAG, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || null;
}

/** The Bronze calendar event columns an event's prickle is made from. */
export interface CalendarSource {
  summary: string | null;
  description: string | null;
  location: string | null;
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

/** The calendar item's prickle, made now as an "Event"-type prickle when it matched no prickle type (a retreat). */
async function prickleForCalendarItem(db: Db, calendarEventId: string, source: CalendarSource) {
  const prickles = createRepos(db).prickles;
  const [found] = await prickles.byCalendarEventIds([calendarEventId]);
  if (found) return found;
  const typeId = await prickles.typeIdByNormalizedName("event");
  if (!typeId) throw new Error("The Event prickle type is missing");
  await prickles.createCalendarPrickles([
    {
      typeId,
      hostId: null,
      calendarEventId,
      title: calendarTitle(source.summary),
      description: plainTextDescription(source.description),
      location: source.location?.trim() || null,
      startTime: source.start_time,
      endTime: source.end_time,
    },
  ]);
  const [made] = await prickles.byCalendarEventIds([calendarEventId]);
  if (!made) throw new Error("Could not create the prickle for this calendar event");
  return made;
}

/**
 * Shows a calendar item in Events: creates the event standing on its prickle (or returns the one it
 * already has). A calendar item that matched no prickle type gets a prickle of the Event type first, which
 * the calendar process later keeps in step with the item. The slug is the title and date, with a numeric
 * suffix if another event has it.
 */
export async function elevateCalendarEvent(db: Db, calendarEventId: string, userId: string | null, automatic = false): Promise<ElevateResult> {
  const events = createRepos(db).events;
  let source;
  let prickle;
  try {
    source = await createRepos(db).calendarEvents.byId(calendarEventId);
    if (!source) return { ok: false, status: 404, error: "Calendar event not found" };
    prickle = await prickleForCalendarItem(db, calendarEventId, source);
    const existing = await events.byPrickleId(prickle.id);
    if (existing) {
      // An admin showing an item the sync made by itself keeps it: the sync no longer takes it away.
      if (existing.automatic && !automatic) await events.update(existing.id, { automatic: false });
      return { ok: true, created: false, event: { id: existing.id, slug: existing.slug, hidden: existing.deleted_at !== null } };
    }
  } catch (e) {
    return { ok: false, status: 500, error: (e as Error).message };
  }

  // The new event starts with its prickle type's audience (announced publicly, guests allowed); an admin can
  // change it on the event. The "[Category]" of the calendar title is the event's focus.
  const title = prickle.title?.trim() || prickle.type?.name || calendarTitle(source.summary);
  for (const slug of eventSlugCandidates(title, prickle.startTime, prickle.id)) {
    try {
      const result = await events.createForPrickle({
        slug,
        prickle_id: prickle.id,
        announced_publicly: prickle.type?.announcedPublicly ?? false,
        guests_allowed: prickle.type?.guestsAllowed ?? false,
        focus: calendarCategory(source.summary),
        event_type: prickleEventKind(prickle.type?.normalizedName),
        created_by: userId,
        automatic,
      });
      if (result.status === "created") return { ok: true, created: true, event: { ...result.event, hidden: false } };
      if (result.on === "prickle") {
        // Someone showed it a moment ago; return theirs.
        const theirs = await events.byPrickleId(prickle.id);
        if (theirs) return { ok: true, created: false, event: { id: theirs.id, slug: theirs.slug, hidden: theirs.deleted_at !== null } };
      }
    } catch (e) {
      return { ok: false, status: 500, error: (e as Error).message };
    }
  }
  // Unreachable in practice: the last candidate carries the prickle's own id, which no other event has.
  return { ok: false, status: 500, error: "Could not find a free address for this event" };
}

/**
 * The addresses to try for an event, most readable first: the title and the Eastern day, then with the start
 * time (two sessions of one type on one day), then with the end of the prickle's id (which is unique). A
 * fixed list, not a counter: the same prickle always ends up at the same address.
 */
export function eventSlugCandidates(title: string, startIso: string, prickleId: string): string[] {
  const base = `${slugify(title) || "event"}-${orgDate(startIso)}`;
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(startIso))
    .replace(":", "");
  const withTime = `${base}-${clock}`;
  return [base, withTime, `${withTime}-${prickleId.slice(-4).toLowerCase()}`];
}

/**
 * Makes sure each of these calendar events has an event, creating the ones that don't as automatic events
 * (a removed event counts as having one, so it stays removed). Used by the calendar sync for items of prickle
 * types listed in Events and items tagged #event, so a recurring session needs no click. Returns how many it created.
 */
export async function ensureCalendarEvents(db: Db, calendarEventIds: string[]): Promise<number> {
  if (calendarEventIds.length === 0) return 0;

  const have = await createRepos(db).events.calendarEventIdsWithEvent(calendarEventIds);
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
 * After the calendar is processed: takes away the automatic events whose reason has stopped applying, so
 * the events follow the calendar and the prickle types both ways. These are the automatic events that follow
 * one of `sourceIds` (the calendar events just processed) but are not in `qualifying` (the ones that still
 * have a reason: a listed prickle type or an #event tag), and the automatic events whose calendar event is
 * gone. An event with photos, attendees or a badge is kept: it has been worked on, whatever made it.
 * Returns how many it removed.
 */
export async function reconcileAutomaticEvents(db: Db, sourceIds: string[], qualifying: ReadonlySet<string>): Promise<number> {
  const repos = createRepos(db);
  const stale: string[] = (await repos.events.automaticFollowing(sourceIds)).filter((r) => !qualifying.has(r.calendarEventId)).map((r) => r.id);
  // The calendar event is gone (the link was cleared when it was deleted), so nothing can make this event apply.
  stale.push(...(await repos.events.automaticWithoutCalendarEvent()));
  if (stale.length === 0) return 0;

  const worked = new Set<string>(await repos.badges.linkedEventIds());
  for (const id of await repos.events.idsWithPhotosOrAttendees(stale)) worked.add(id);
  const removable = stale.filter((id) => !worked.has(id));

  await repos.events.deleteByIds(removable);
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
