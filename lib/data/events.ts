import { ORG_TIMEZONE } from "@/lib/config";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";
import type { Prickle } from "./prickles";

/**
 * An event as the in-memory dataset keeps it: only what the `events` table holds. Its schedule (title,
 * host, times...) is the prickle `prickle_id` points at, joined in by `eventDetail`. The rest of the
 * columns are optional so a test or seed names just the ones it cares about.
 */
export type EventRow = Pick<Row<"community_events">, "id" | "slug" | "prickle_id"> & Partial<Omit<Row<"community_events">, "id" | "slug" | "prickle_id">>;

/**
 * An event with the schedule of the prickle it stands on (the `community_event_details` view): the title is the
 * prickle's own, else its type's name; `starts_at`/`ends_at` are Eastern days (YYYY-MM-DD), an event
 * ending exactly at midnight ending the day before. Nothing here is stored on the event itself.
 */
export type EventDetail = Row<"community_events"> & {
  title: string;
  description: string | null;
  location: string | null;
  /** The guest speaker of the prickle. */
  speakers: string | null;
  /** Member id of the prickle's host, if it has one. */
  host_id: string | null;
  /** The host's display name (else name), else a Hub session's free-text host. */
  host_name: string | null;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
};

/** YYYY-MM-DD of an instant in the organization's timezone. */
const orgDay = (instant: string | number | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

/** The Eastern days a prickle's window covers: it starts on `starts_at` and, ending exactly at midnight, ends the day before. */
export function eventDays(startTime: string, endTime: string): { starts_at: string; ends_at: string } {
  const start = new Date(startTime).getTime();
  const lastMinute = Math.max(start, new Date(endTime).getTime() - 60_000);
  return { starts_at: orgDay(start), ends_at: orgDay(lastMinute) };
}

/**
 * An in-memory event joined with its prickle (type name for the title, member names for the host, hub
 * session for a free-text host), the way the `community_event_details` view does it. Null when the prickle is missing.
 */
export function eventDetail(data: InMemoryDataset, event: EventRow): EventDetail | null {
  const prickle = data.prickles.find((p) => p.id === event.prickle_id);
  if (!prickle) return null;
  const type = data.prickleTypes.find((t) => t.id === prickle.typeId);
  const host = prickle.hostId ? data.members.find((m) => m.id === prickle.hostId) : undefined;
  const session = prickle.hubSessionId ? data.hubSessions.find((s) => s.id === prickle.hubSessionId) : undefined;
  return {
    agenda: null,
    announced_publicly: false,
    automatic: false,
    capacity: null,
    created_at: prickle.startTime,
    created_by: null,
    deleted_at: null,
    event_type: "other",
    focus: null,
    google_photos_album_url: null,
    guests_allowed: false,
    image_id: null,
    registration: "none",
    results: null,
    selection: "first_come",
    updated_at: prickle.startTime,
    ...event,
    title: prickle.title?.trim() || type?.name || "Untitled event",
    description: prickle.description ?? null,
    location: prickle.location ?? null,
    speakers: prickle.guestSpeaker ?? null,
    host_id: prickle.hostId,
    host_name: host?.displayName?.trim() || host?.name || session?.hostName || null,
    start_time: prickle.startTime,
    end_time: prickle.endTime,
    ...eventDays(prickle.startTime, prickle.endTime),
  };
}

/** The in-memory event details, every event that has a prickle. */
export const eventDetails = (data: InMemoryDataset): EventDetail[] => data.events.flatMap((e) => eventDetail(data, e) ?? []);

/** The calendar item a prickle comes from, for the calendar-sync reads. */
const calendarOf = (data: InMemoryDataset, prickleId: string): Prickle | undefined => data.prickles.find((p) => p.id === prickleId);


/** An attendee row as the in-memory dataset keeps it (only the event matters to the calendar sync). */
export type EventAttendeeRow = Pick<Row<"event_attendees">, "event_id"> & Partial<Omit<Row<"event_attendees">, "event_id">>;

export type EventPhotoRow = Row<"event_photos">;

/** An event as a picker lists it (badge forms link a retreat badge to one). */
export interface EventChoice {
  id: string;
  title: string;
  starts_at: string;
}

/**
 * Community events (retreats, workshops, speaker sessions): the `events` table and, as the methods
 * land, its attendees and photos. Every method throws on a database error.
 */
export interface EventRepository {
  /** Every event that has a start time, newest first, for a picker. Paginated. */
  choices(): Promise<EventChoice[]>;

  // --- photos ---

  /** Google media item ids already imported for an event (hidden ones included: they still count for dedup). Paginated. */
  importedPhotoIds(eventId: string): Promise<Set<string>>;
  /** Adds an imported photo row and returns it. Throws if the database refuses it (e.g. the same media item twice). */
  addPhoto(photo: NewEventPhoto): Promise<EventPhotoRow>;
  /** Hides (stamps `hidden_at`) or unhides a photo of this event; null when the event has no such photo. */
  setPhotoHidden(eventId: string, photoId: string, hidden: boolean): Promise<EventPhotoRow | null>;
  /** What the image proxy needs to serve a photo of this event; null when there is none. */
  photoFile(eventId: string, photoId: string): Promise<EventPhotoFile | null>;

  // --- calendar sync ---

  /** The event standing on the prickle made from this calendar event (a hidden one included), or null. */
  byCalendarEventId(calendarEventId: string): Promise<CalendarLinkedEvent | null>;
  /** The event standing on this prickle (a hidden one included), with its schedule, or null. */
  byPrickleId(prickleId: string): Promise<EventDetail | null>;
  /** Which of these calendar events already have an event through their prickle (hidden ones count). Chunked. */
  calendarEventIdsWithEvent(calendarEventIds: string[]): Promise<Set<string>>;
  /** The events standing on the prickles of these calendar events. Chunked. */
  linkedToCalendarEvents(calendarEventIds: string[]): Promise<CalendarFollower[]>;
  /** Creates an event on a prickle; a unique violation (the prickle already has one, or the slug is taken) comes back as a conflict instead of throwing, so the caller can retry. */
  createForPrickle(row: Insert<"community_events">): Promise<CreateEventResult>;
  /** Writes these columns to one event. */
  update(id: string, fields: Update<"community_events">): Promise<void>;
  /** The automatic events standing on a prickle of one of these calendar events. Chunked. */
  automaticFollowing(calendarEventIds: string[]): Promise<{ id: string; calendarEventId: string }[]>;
  /** Ids of the automatic events whose prickle no longer has a calendar event (the item is gone). Paginated. */
  automaticWithoutCalendarEvent(): Promise<string[]>;
  /** Which of these events have a photo or an attendee. Chunked. */
  idsWithPhotosOrAttendees(eventIds: string[]): Promise<Set<string>>;
  /** Deletes these events. Chunked. */
  deleteByIds(ids: string[]): Promise<void>;

  // --- member-facing reads ---

  /** Every event (hidden ones too, flagged by `deleted_at`), newest first, each with the id of its first visible photo. Paginated. */
  listWithCover(): Promise<EventListItem[]>;
  /** The visible (not hidden by an admin) event with this slug, with its schedule, or null. */
  visibleBySlug(slug: string): Promise<EventDetail | null>;
  /** The event's photos an admin has not hidden, in the order they were taken. */
  visiblePhotos(eventId: string): Promise<EventPhotoSummary[]>;
  /** Whether a visible event has this id. */
  isVisible(eventId: string): Promise<boolean>;
  /** The visible events among these ids that have not ended before `endsOnOrAfter` (a YYYY-MM-DD date). Order unspecified. */
  visibleEndingFrom(eventIds: string[], endsOnOrAfter: string): Promise<FeedEvent[]>;
  /** Events matching every word, newest first, one page. */
  search(query: EventSearchQuery): Promise<EventSearchHit[]>;

  // --- admin events ---

  /** Every event, newest first, each with how many of its photos are not hidden. Paginated. */
  listWithPhotoCounts(): Promise<EventWithPhotoCount[]>;
  /** One event by id with its schedule, or null. */
  byId(id: string): Promise<EventDetail | null>;
  /** One event by slug with its schedule (a hidden one included), or null: the admin page's address. */
  bySlug(slug: string): Promise<EventDetail | null>;
  /** Creates an event (it needs `prickle_id`) and returns it with its schedule. */
  create(fields: Insert<"community_events">): Promise<EventDetail>;
  /** Updates an event and returns it; throws when there is no such event. (`update` writes without reading back.) */
  edit(id: string, fields: Update<"community_events">): Promise<EventDetail>;
  /** Hides an event (`deletedAt` set) or shows it again (null); the event, or null when there is none. */
  setDeletedAt(id: string, deletedAt: string | null): Promise<EventDetail | null>;
  /** Deletes an event; its photo and attendee rows go with it. */
  remove(id: string): Promise<void>;
  /** An event's photos, oldest first (undated last). */
  allPhotosOf(eventId: string): Promise<Row<"event_photos">[]>;
  /** The storage paths of an event's photos. Paginated. */
  photoPaths(eventId: string): Promise<string[]>;
  /** An event's attendees with the member's names, in the order they were added. */
  attendeesOf(eventId: string): Promise<EventAttendeeEntry[]>;
  /** For each given calendar event that has an event, whether it is shown to members or hidden. Chunked. */
  visibilityByCalendarEvent(calendarEventIds: string[]): Promise<Map<string, "shown" | "hidden">>;
}

/** An event that follows a calendar event. */
export interface CalendarLinkedEvent {
  id: string;
  slug: string;
  /** Removed from Events (soft deleted). */
  hidden: boolean;
  /** Made by the calendar sync rather than by an admin. */
  automatic: boolean;
}

export interface CalendarFollower {
  id: string;
  calendarEventId: string | null;
  prickleId: string;
}

export type CreateEventResult =
  | { status: "created"; event: { id: string; slug: string } }
  | { status: "conflict"; on: "prickle" | "slug" };

const CHUNK = 100;
const chunks = <T>(items: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// --- photos ---
export type NewEventPhoto = Pick<Row<"event_photos">, "event_id" | "storage_path" | "google_media_item_id"> &
  Partial<Pick<Row<"event_photos">, "width" | "height" | "mime_type" | "taken_at">>;
export type EventPhotoFile = Pick<Row<"event_photos">, "storage_path" | "mime_type" | "hidden_at">;

// --- member-facing reads ---

export interface EventListItem {
  id: string;
  slug: string;
  title: string;
  event_type: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  start_time: string;
  end_time: string;
  focus: string | null;
  registration: string;
  speakers: string | null;
  host_name: string | null;
  /** The prickle the event stands on. */
  prickle_id: string;
  deleted_at: string | null;
  /** The cover picked from the media library, if any. */
  imageId: string | null;
  coverPhotoId: string | null;
}

export interface EventPhotoSummary {
  id: string;
  width: number | null;
  height: number | null;
}

export interface FeedEvent {
  id: string;
  slug: string;
  title: string;
  speakers: string | null;
  host_name: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
}

export interface EventSearchQuery {
  /** Each word must appear in the title, speakers, host, location, focus or description (case-insensitive). */
  words: string[];
  /** Only events one of these members attended; an empty list matches nothing. */
  attendedBy?: string[] | null;
  /** Include events an admin hid. */
  includeHidden?: boolean;
  /** Dates (YYYY-MM-DD): starts at or after / before. */
  after?: string;
  before?: string;
  limit: number;
  offset: number;
}

export interface EventSearchHit {
  id: string;
  slug: string;
  title: string;
  speakers: string | null;
  host_name: string | null;
  event_type: string;
  location: string | null;
  starts_at: string;
  focus: string | null;
}

const SEARCH_FIELDS = ["title", "speakers", "host_name", "location", "focus", "description"] as const;
const ID_CHUNK_SIZE = 200;
/** A search word with the characters that mean something to LIKE or to a PostgREST filter neutralized. */
const searchWord = (word: string) => word.replace(/[\\%_,()"]/g, " ").trim();
const byStartsAtDesc = (a: { starts_at: string; id: string }, b: { starts_at: string; id: string }) =>
  a.starts_at !== b.starts_at ? (a.starts_at < b.starts_at ? 1 : -1) : a.id < b.id ? -1 : 1;
const photoOrder = (a: EventPhotoRow, b: EventPhotoRow) => {
  const ta = a.taken_at ?? null;
  const tb = b.taken_at ?? null;
  if (ta !== tb) return ta === null ? 1 : tb === null ? -1 : ta < tb ? -1 : 1;
  return a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1;
};

/** An event with its count of photos that are not hidden. */
export type EventWithPhotoCount = EventDetail & { photo_count: number };

/** An event attendee with the member's names (null when the member row is gone). */
export interface EventAttendeeEntry {
  id: string;
  member_id: string;
  member: { name: string; display_name: string | null; email: string } | null;
}

const byStartsDesc = (a: { starts_at?: string; id: string }, b: { starts_at?: string; id: string }) =>
  (a.starts_at ?? "") < (b.starts_at ?? "") ? 1 : (a.starts_at ?? "") > (b.starts_at ?? "") ? -1 : a.id < b.id ? -1 : 1;

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly db: Db) {}

  async choices(): Promise<EventChoice[]> {
    return fetchAllRows<EventChoice>(
      (from, to) => this.db.from("community_event_details").select("id, title, starts_at").order("starts_at", { ascending: false }).order("id").range(from, to).overrideTypes<EventChoice[], { merge: false }>() // view columns are all nullable in the generated types
    );
  }

  // --- photos ---

  async importedPhotoIds(eventId: string) {
    const rows = await fetchAllRows<{ id: string; google_media_item_id: string }>(
      (from, to) => this.db.from("event_photos").select("id, google_media_item_id").eq("event_id", eventId).order("id").range(from, to)
    );
    return new Set(rows.map((r) => r.google_media_item_id));
  }

  async addPhoto(photo: NewEventPhoto) {
    const { data, error } = await this.db.from("event_photos").insert(photo).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async setPhotoHidden(eventId: string, photoId: string, hidden: boolean) {
    const { data, error } = await this.db
      .from("event_photos")
      .update({ hidden_at: hidden ? new Date().toISOString() : null })
      .eq("id", photoId)
      .eq("event_id", eventId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async photoFile(eventId: string, photoId: string) {
    const { data, error } = await this.db
      .from("event_photos")
      .select("storage_path, mime_type, hidden_at")
      .eq("id", photoId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  // --- calendar sync ---

  async byCalendarEventId(calendarEventId: string) {
    const { data, error } = await this.db
      .from("community_events")
      .select("id, slug, deleted_at, automatic, prickles!inner(calendar_event_id)")
      .eq("prickles.calendar_event_id", calendarEventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, slug: data.slug, hidden: !!data.deleted_at, automatic: !!data.automatic } : null;
  }

  async byPrickleId(prickleId: string) {
    const { data, error } = await this.db.from("community_event_details").select("*").eq("prickle_id", prickleId).maybeSingle().overrideTypes<EventDetail, { merge: false }>(); // view columns are all nullable in the generated types
    if (error) throw new Error(error.message);
    return data;
  }

  /** Events with the calendar event of their prickle, for these calendar events. */
  private async onCalendarEvents(calendarEventIds: string[], automaticOnly = false) {
    const out: { id: string; prickleId: string; calendarEventId: string; deletedAt: string | null }[] = [];
    for (const ids of chunks(calendarEventIds)) {
      let query = this.db.from("community_events").select("id, prickle_id, deleted_at, prickles!inner(calendar_event_id)").in("prickles.calendar_event_id", ids);
      if (automaticOnly) query = query.eq("automatic", true);
      const { data, error } = await query.order("id");
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const prickle = Array.isArray(r.prickles) ? r.prickles[0] : r.prickles;
        if (prickle?.calendar_event_id) out.push({ id: r.id, prickleId: r.prickle_id, calendarEventId: prickle.calendar_event_id, deletedAt: r.deleted_at });
      }
    }
    return out;
  }

  async calendarEventIdsWithEvent(calendarEventIds: string[]) {
    return new Set((await this.onCalendarEvents(calendarEventIds)).map((r) => r.calendarEventId));
  }

  async linkedToCalendarEvents(calendarEventIds: string[]) {
    return (await this.onCalendarEvents(calendarEventIds)).map((r) => ({ id: r.id, calendarEventId: r.calendarEventId, prickleId: r.prickleId }));
  }

  async createForPrickle(row: Insert<"community_events">): Promise<CreateEventResult> {
    const { data, error } = await this.db.from("community_events").insert(row).select("id, slug").single();
    if (!error) return { status: "created", event: { id: data.id, slug: data.slug } };
    if (error.code === "23505") return { status: "conflict", on: error.message.includes("prickle_id") ? "prickle" : "slug" };
    throw new Error(error.message);
  }

  async update(id: string, fields: Update<"community_events">) {
    const { error } = await this.db.from("community_events").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async automaticFollowing(calendarEventIds: string[]) {
    return (await this.onCalendarEvents(calendarEventIds, true)).map((r) => ({ id: r.id, calendarEventId: r.calendarEventId }));
  }

  async automaticWithoutCalendarEvent() {
    type Row = { id: string; prickles: { calendar_event_id: string | null } | { calendar_event_id: string | null }[] | null };
    const rows = await fetchAllRows<Row>(
      (from, to) => this.db.from("community_events").select("id, prickles!inner(calendar_event_id)").eq("automatic", true).is("prickles.calendar_event_id", null).order("id").range(from, to)
    );
    return rows.map((r) => r.id);
  }

  async idsWithPhotosOrAttendees(eventIds: string[]) {
    const worked = new Set<string>();
    for (const chunk of chunks(eventIds)) {
      const [photos, attendees] = await Promise.all([
        this.db.from("event_photos").select("event_id").in("event_id", chunk),
        this.db.from("event_attendees").select("event_id").in("event_id", chunk),
      ]);
      for (const result of [photos, attendees]) {
        if (result.error) throw new Error(result.error.message);
        for (const row of result.data ?? []) if (row.event_id) worked.add(row.event_id);
      }
    }
    return worked;
  }

  async deleteByIds(ids: string[]) {
    for (const chunk of chunks(ids)) {
      const { error } = await this.db.from("community_events").delete().in("id", chunk);
      if (error) throw new Error(error.message);
    }
  }

  // --- member-facing reads ---

  async listWithCover(): Promise<EventListItem[]> {
    type Raw = Omit<EventListItem, "coverPhotoId" | "imageId"> & { image_id: string | null; event_photos: { id: string; hidden_at: string | null }[] | null };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("community_event_details")
          .select("id, slug, title, event_type, location, starts_at, ends_at, start_time, end_time, focus, registration, speakers, host_name, prickle_id, deleted_at, image_id, event_photos(id, hidden_at)")
          .order("starts_at", { ascending: false })
          .order("id")
          .order("taken_at", { referencedTable: "event_photos", ascending: true, nullsFirst: false })
          .order("created_at", { referencedTable: "event_photos", ascending: true })
          .order("id", { referencedTable: "event_photos" })
          .range(from, to)
          .overrideTypes<Raw[], { merge: false }>() // view columns are all nullable in the generated types
    );
    return rows.map(({ event_photos, image_id, ...e }) => ({ ...e, imageId: image_id, coverPhotoId: (event_photos ?? []).find((p) => !p.hidden_at)?.id ?? null }));
  }

  async visibleBySlug(slug: string): Promise<EventDetail | null> {
    const { data, error } = await this.db.from("community_event_details").select("*").eq("slug", slug).is("deleted_at", null).maybeSingle().overrideTypes<EventDetail, { merge: false }>(); // view columns are all nullable in the generated types
    if (error) throw new Error(error.message);
    return data;
  }

  // --- admin events ---

  async listWithPhotoCounts() {
    type Embedded = EventDetail & { event_photos: { id: string; hidden_at: string | null }[] | null };
    const rows = await fetchAllRows<Embedded>(
      (from, to) => this.db.from("community_event_details").select("*, event_photos(id, hidden_at)").order("starts_at", { ascending: false }).order("id").range(from, to).overrideTypes<Embedded[], { merge: false }>() // view columns are all nullable in the generated types
    );
    return rows.map(({ event_photos, ...event }) => ({ ...event, photo_count: (event_photos ?? []).filter((p) => !p.hidden_at).length }));
  }

  async byId(id: string) {
    const { data, error } = await this.db.from("community_event_details").select("*").eq("id", id).maybeSingle().overrideTypes<EventDetail, { merge: false }>(); // view columns are all nullable in the generated types
    if (error) throw new Error(error.message);
    return data;
  }

  async visiblePhotos(eventId: string): Promise<EventPhotoSummary[]> {
    const { data, error } = await this.db
      .from("event_photos")
      .select("id, width, height")
      .eq("event_id", eventId)
      .is("hidden_at", null)
      .order("taken_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async isVisible(eventId: string): Promise<boolean> {
    const { data, error } = await this.db.from("community_events").select("id").eq("id", eventId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async visibleEndingFrom(eventIds: string[], endsOnOrAfter: string): Promise<FeedEvent[]> {
    const out: FeedEvent[] = [];
    for (const ids of chunk(eventIds, ID_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from("community_event_details")
        .select("id, slug, title, speakers, host_name, location, starts_at, ends_at")
        .in("id", ids)
        .is("deleted_at", null)
        .gte("ends_at", endsOnOrAfter)
        .overrideTypes<FeedEvent[], { merge: false }>(); // view columns are all nullable in the generated types
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
    }
    return out;
  }

  async search(q: EventSearchQuery): Promise<EventSearchHit[]> {
    let attendedIds: string[] | null = null;
    if (q.attendedBy) {
      const found = new Set<string>();
      for (const ids of chunk(q.attendedBy, ID_CHUNK_SIZE)) {
        const { data, error } = await this.db.from("event_attendees").select("event_id").in("member_id", ids).order("id").limit(1000);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) found.add(r.event_id);
      }
      if (found.size === 0) return [];
      attendedIds = [...found].slice(0, 1000);
    }
    let query = this.db.from("community_event_details").select("id, slug, title, speakers, host_name, event_type, location, starts_at, focus");
    for (const word of q.words) {
      query = query.or(SEARCH_FIELDS.map((f) => `${f}.ilike."%${searchWord(word)}%"`).join(","));
    }
    if (attendedIds) query = query.in("id", attendedIds);
    if (!q.includeHidden) query = query.is("deleted_at", null);
    if (q.after) query = query.gte("starts_at", q.after.slice(0, 10));
    if (q.before) query = query.lt("starts_at", q.before.slice(0, 10));
    const { data, error } = await query
      .order("starts_at", { ascending: false })
      .order("id")
      .range(q.offset, q.offset + q.limit - 1)
      .overrideTypes<EventSearchHit[], { merge: false }>(); // view columns are all nullable in the generated types
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(fields: Insert<"community_events">) {
    const { data, error } = await this.db.from("community_events").insert(fields).select("id").single();
    if (error) throw new Error(error.message);
    return this.detailOf(data.id);
  }

  async edit(id: string, fields: Update<"community_events">) {
    const { data, error } = await this.db.from("community_events").update(fields).eq("id", id).select("id").single();
    if (error) throw new Error(error.message);
    return this.detailOf(data.id);
  }

  async setDeletedAt(id: string, deletedAt: string | null) {
    const { data, error } = await this.db.from("community_events").update({ deleted_at: deletedAt }).eq("id", id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.detailOf(data.id) : null;
  }

  async bySlug(slug: string) {
    const { data, error } = await this.db.from("community_event_details").select("*").eq("slug", slug).maybeSingle().overrideTypes<EventDetail, { merge: false }>(); // view columns are all nullable in the generated types
    if (error) throw new Error(error.message);
    return data;
  }

  private async detailOf(id: string): Promise<EventDetail> {
    const event = await this.byId(id);
    if (!event) throw new Error(`event ${id} not found`);
    return event;
  }

  async remove(id: string) {
    const { error } = await this.db.from("community_events").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async allPhotosOf(eventId: string) {
    return fetchAllRows<Row<"event_photos">>(
      (from, to) =>
        this.db
          .from("event_photos")
          .select("*")
          .eq("event_id", eventId)
          .order("taken_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to)
    );
  }

  async photoPaths(eventId: string) {
    const rows = await fetchAllRows<{ storage_path: string }>(
      (from, to) => this.db.from("event_photos").select("storage_path").eq("event_id", eventId).order("id").range(from, to)
    );
    return rows.map((r) => r.storage_path);
  }

  async attendeesOf(eventId: string) {
    type Embedded = { id: string; member_id: string; members: EventAttendeeEntry["member"] };
    const rows = await fetchAllRows<Embedded>(
      (from, to) =>
        this.db
          .from("event_attendees")
          .select("id, member_id, members(name, display_name, email)")
          .eq("event_id", eventId)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to)
    );
    return rows.map((r) => ({ id: r.id, member_id: r.member_id, member: r.members }));
  }

  async visibilityByCalendarEvent(calendarEventIds: string[]) {
    const out = new Map<string, "shown" | "hidden">();
    for (const r of await this.onCalendarEvents(calendarEventIds)) out.set(r.calendarEventId, r.deletedAt ? "hidden" : "shown");
    return out;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryEventRepository implements EventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async choices() {
    return eventDetails(this.data)
      .map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at }))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : a.starts_at > b.starts_at ? -1 : a.id < b.id ? -1 : 1));
  }

  // --- photos ---

  async importedPhotoIds(eventId: string) {
    return new Set(this.data.eventPhotos.filter((p) => p.event_id === eventId).map((p) => p.google_media_item_id));
  }

  async addPhoto(photo: NewEventPhoto) {
    if (this.data.eventPhotos.some((p) => p.event_id === photo.event_id && p.google_media_item_id === photo.google_media_item_id)) {
      throw new Error("duplicate key value violates unique constraint on event_photos");
    }
    const row: EventPhotoRow = {
      id: `evph_${this.data.eventPhotos.length + 1}`,
      created_at: new Date().toISOString(),
      hidden_at: null,
      width: null,
      height: null,
      mime_type: null,
      taken_at: null,
      ...photo,
    };
    this.data.eventPhotos.push(row);
    return { ...row };
  }

  async setPhotoHidden(eventId: string, photoId: string, hidden: boolean) {
    const photo = this.data.eventPhotos.find((p) => p.id === photoId && p.event_id === eventId);
    if (!photo) return null;
    photo.hidden_at = hidden ? new Date().toISOString() : null;
    return { ...photo };
  }

  async photoFile(eventId: string, photoId: string) {
    const photo = this.data.eventPhotos.find((p) => p.id === photoId && p.event_id === eventId);
    return photo ? { storage_path: photo.storage_path, mime_type: photo.mime_type, hidden_at: photo.hidden_at } : null;
  }

  // --- calendar sync ---

  /** The events standing on a prickle that comes from one of these calendar events. */
  private onCalendarEvents(calendarEventIds: string[], automaticOnly = false) {
    const wanted = new Set(calendarEventIds);
    return this.data.events
      .flatMap((e) => {
        const calendarEventId = calendarOf(this.data, e.prickle_id)?.calendarEventId;
        return calendarEventId && wanted.has(calendarEventId) && (!automaticOnly || e.automatic) ? [{ event: e, calendarEventId }] : [];
      })
      .sort((a, b) => (a.event.id < b.event.id ? -1 : 1));
  }

  async byCalendarEventId(calendarEventId: string) {
    const e = this.onCalendarEvents([calendarEventId])[0]?.event;
    return e ? { id: e.id, slug: e.slug, hidden: !!e.deleted_at, automatic: !!e.automatic } : null;
  }

  async byPrickleId(prickleId: string) {
    const e = this.data.events.find((x) => x.prickle_id === prickleId);
    return e ? eventDetail(this.data, e) : null;
  }

  async calendarEventIdsWithEvent(calendarEventIds: string[]) {
    return new Set(this.onCalendarEvents(calendarEventIds).map((r) => r.calendarEventId));
  }

  async linkedToCalendarEvents(calendarEventIds: string[]) {
    return this.onCalendarEvents(calendarEventIds).map((r) => ({ id: r.event.id, calendarEventId: r.calendarEventId, prickleId: r.event.prickle_id }));
  }

  async createForPrickle(row: Insert<"community_events">): Promise<CreateEventResult> {
    if (this.data.events.some((e) => e.prickle_id === row.prickle_id)) return { status: "conflict", on: "prickle" };
    if (this.data.events.some((e) => e.slug === row.slug)) return { status: "conflict", on: "slug" };
    const id = row.id ?? `evt_mem${this.data.events.length + 1}`;
    this.data.events.push({ automatic: false, deleted_at: null, ...(row as Partial<Row<"community_events">>), id, slug: row.slug, prickle_id: row.prickle_id });
    return { status: "created", event: { id, slug: row.slug } };
  }

  async update(id: string, fields: Update<"community_events">) {
    const e = this.data.events.find((x) => x.id === id);
    if (e) Object.assign(e, fields);
  }

  async automaticFollowing(calendarEventIds: string[]) {
    return this.onCalendarEvents(calendarEventIds, true).map((r) => ({ id: r.event.id, calendarEventId: r.calendarEventId }));
  }

  async automaticWithoutCalendarEvent() {
    return this.data.events.filter((e) => e.automatic && !calendarOf(this.data, e.prickle_id)?.calendarEventId).map((e) => e.id).sort();
  }

  async idsWithPhotosOrAttendees(eventIds: string[]) {
    const wanted = new Set(eventIds);
    return new Set([...this.data.eventPhotos, ...this.data.eventAttendees].flatMap((r) => (r.event_id && wanted.has(r.event_id) ? [r.event_id] : [])));
  }

  async deleteByIds(ids: string[]) {
    const gone = new Set(ids);
    this.data.events = this.data.events.filter((e) => !gone.has(e.id));
  }

  // --- member-facing reads ---

  async listWithCover(): Promise<EventListItem[]> {
    return [...eventDetails(this.data)].sort(byStartsAtDesc).map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      event_type: e.event_type,
      location: e.location,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      start_time: e.start_time,
      end_time: e.end_time,
      focus: e.focus,
      registration: e.registration,
      speakers: e.speakers,
      host_name: e.host_name,
      prickle_id: e.prickle_id,
      deleted_at: e.deleted_at,
      imageId: e.image_id,
      coverPhotoId: this.photosOf(e.id).find((p) => !p.hidden_at)?.id ?? null,
    }));
  }

  async visibleBySlug(slug: string): Promise<EventDetail | null> {
    const e = this.data.events.find((row) => row.slug === slug && !row.deleted_at);
    return e ? eventDetail(this.data, e) : null;
  }

  async visiblePhotos(eventId: string): Promise<EventPhotoSummary[]> {
    return this.photosOf(eventId)
      .filter((p) => !p.hidden_at)
      .map((p) => ({ id: p.id, width: p.width, height: p.height }));
  }

  async isVisible(eventId: string): Promise<boolean> {
    return this.data.events.some((e) => e.id === eventId && !e.deleted_at);
  }

  async visibleEndingFrom(eventIds: string[], endsOnOrAfter: string): Promise<FeedEvent[]> {
    const wanted = new Set(eventIds);
    return eventDetails(this.data)
      .filter((e) => wanted.has(e.id) && !e.deleted_at && e.ends_at >= endsOnOrAfter)
      .map((e) => ({ id: e.id, slug: e.slug, title: e.title, speakers: e.speakers, host_name: e.host_name, location: e.location, starts_at: e.starts_at, ends_at: e.ends_at }));
  }

  async search(q: EventSearchQuery): Promise<EventSearchHit[]> {
    const attendedBy = q.attendedBy;
    const attended = attendedBy ? new Set(this.data.eventAttendees.filter((a) => a.member_id !== undefined && attendedBy.includes(a.member_id)).map((a) => a.event_id)) : null;
    if (attended && attended.size === 0) return [];
    const words = q.words.map((w) => searchWord(w).toLowerCase());
    const dayStart = (d: string) => Date.parse(d.slice(0, 10));
    return eventDetails(this.data)
      .filter((e) => {
        if (attended && !attended.has(e.id)) return false;
        if (!q.includeHidden && e.deleted_at) return false;
        if (q.after && Date.parse(e.starts_at) < dayStart(q.after)) return false;
        if (q.before && Date.parse(e.starts_at) >= dayStart(q.before)) return false;
        return words.every((w) => SEARCH_FIELDS.some((f) => (e[f] ?? "").toLowerCase().includes(w)));
      })
      .sort(byStartsAtDesc)
      .slice(q.offset, q.offset + q.limit)
      .map((e) => ({ id: e.id, slug: e.slug, title: e.title, speakers: e.speakers, host_name: e.host_name, event_type: e.event_type, location: e.location, starts_at: e.starts_at, focus: e.focus }));
  }

  private photosOf(eventId: string) {
    return this.data.eventPhotos.filter((p) => p.event_id === eventId).sort(photoOrder);
  }

  // --- admin events ---

  private nextId = 0;

  private detail(row: EventRow): EventDetail {
    const detail = eventDetail(this.data, row);
    if (!detail) throw new Error(`event ${row.id} has no prickle`);
    return detail;
  }

  async listWithPhotoCounts() {
    return [...eventDetails(this.data)].sort(byStartsDesc).map((e) => ({
      ...e,
      photo_count: this.data.eventPhotos.filter((p) => p.event_id === e.id && !p.hidden_at).length,
    }));
  }

  async byId(id: string) {
    const row = this.data.events.find((e) => e.id === id);
    return row ? eventDetail(this.data, row) : null;
  }

  async bySlug(slug: string) {
    const row = this.data.events.find((e) => e.slug === slug);
    return row ? eventDetail(this.data, row) : null;
  }

  async create(fields: Insert<"community_events">) {
    if (!fields.slug || !fields.prickle_id) throw new Error("null value in column violates not-null constraint");
    if (!this.data.prickles.some((p) => p.id === fields.prickle_id)) throw new Error("violates foreign key constraint community_events_prickle_id_fkey");
    if (this.data.events.some((e) => e.prickle_id === fields.prickle_id)) throw new Error("duplicate key value violates unique constraint community_events_prickle_id_key");
    if (this.data.events.some((e) => e.slug === fields.slug)) throw new Error("duplicate key value violates unique constraint community_events_slug_key");
    const row = { id: `evt_created${++this.nextId}`, ...fields } as EventRow;
    this.data.events.push(row);
    return this.detail(row);
  }

  async edit(id: string, fields: Update<"community_events">) {
    const row = this.data.events.find((e) => e.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, fields);
    return this.detail(row);
  }

  async setDeletedAt(id: string, deletedAt: string | null) {
    const row = this.data.events.find((e) => e.id === id);
    if (!row) return null;
    row.deleted_at = deletedAt;
    return this.detail(row);
  }

  async remove(id: string) {
    this.data.events = this.data.events.filter((e) => e.id !== id);
    this.data.eventPhotos = this.data.eventPhotos.filter((p) => p.event_id !== id);
    this.data.eventAttendees = this.data.eventAttendees.filter((a) => a.event_id !== id);
  }

  async allPhotosOf(eventId: string) {
    const when = (p: Row<"event_photos">) => p.taken_at;
    return this.data.eventPhotos
      .filter((p) => p.event_id === eventId)
      .sort((a, b) => {
        if (when(a) !== when(b)) {
          if (!when(a)) return 1;
          if (!when(b)) return -1;
          return when(a)! < when(b)! ? -1 : 1;
        }
        return a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1;
      })
      .map((p) => ({ ...p }));
  }

  async photoPaths(eventId: string) {
    return this.data.eventPhotos.filter((p) => p.event_id === eventId).map((p) => p.storage_path);
  }

  async attendeesOf(eventId: string) {
    return this.data.eventAttendees
      .flatMap((a) => (a.event_id === eventId && a.member_id ? [{ id: a.id ?? "", member_id: a.member_id, created_at: a.created_at ?? "" }] : []))
      .sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1))
      .map((a) => {
        const m = this.data.members.find((x) => x.id === a.member_id);
        return { id: a.id, member_id: a.member_id, member: m ? { name: m.name, display_name: m.displayName ?? null, email: m.email ?? "" } : null };
      });
  }

  async visibilityByCalendarEvent(calendarEventIds: string[]) {
    const out = new Map<string, "shown" | "hidden">();
    for (const r of this.onCalendarEvents(calendarEventIds)) out.set(r.calendarEventId, r.event.deleted_at ? "hidden" : "shown");
    return out;
  }
}
