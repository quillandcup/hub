import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * An event as the in-memory dataset keeps it. The badges only need `id`, `title` and `slug`; the rest
 * of the database's columns are optional so a test or seed names just the ones it cares about.
 */
export type EventRow = Pick<Row<"events">, "id" | "title" | "slug"> & Partial<Omit<Row<"events">, "id" | "title" | "slug">>;

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

  /** The event that follows this calendar event (a hidden one included), or null. */
  byCalendarEventId(calendarEventId: string): Promise<CalendarLinkedEvent | null>;
  /** Which of these calendar events already have an event (hidden ones count). Chunked. */
  calendarEventIdsWithEvent(calendarEventIds: string[]): Promise<Set<string>>;
  /** The events that follow these calendar events, with the fields an admin overrode. Chunked. */
  linkedToCalendarEvents(calendarEventIds: string[]): Promise<CalendarFollower[]>;
  /** Creates an event; a unique violation comes back as a conflict instead of throwing, so the caller can retry. */
  createFromCalendar(row: Insert<"events">): Promise<CreateEventResult>;
  /** Writes these columns to one event. */
  update(id: string, fields: Update<"events">): Promise<void>;
  /** The automatic events that follow one of these calendar events. Chunked. */
  automaticFollowing(calendarEventIds: string[]): Promise<{ id: string; calendarEventId: string }[]>;
  /** Ids of the automatic events whose calendar event is gone (no link). Paginated. */
  automaticWithoutCalendarEvent(): Promise<string[]>;
  /** Which of these events have a photo or an attendee. Chunked. */
  idsWithPhotosOrAttendees(eventIds: string[]): Promise<Set<string>>;
  /** Deletes these events. Chunked. */
  deleteByIds(ids: string[]): Promise<void>;

  // --- member-facing reads ---

  /** Every event (hidden ones too, flagged by `deleted_at`), newest first, each with the id of its first visible photo. Paginated. */
  listWithCover(): Promise<EventListItem[]>;
  /** The visible (not hidden by an admin) event with this slug, or null. */
  visibleBySlug(slug: string): Promise<Row<"events"> | null>;
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
  /** One event by id, or null. */
  byId(id: string): Promise<Row<"events"> | null>;
  /** Creates an event and returns it. */
  create(fields: Insert<"events">): Promise<Row<"events">>;
  /** Updates an event and returns it; throws when there is no such event. (`update` writes without reading back.) */
  edit(id: string, fields: Update<"events">): Promise<Row<"events">>;
  /** Hides an event (`deletedAt` set) or shows it again (null); the event, or null when there is none. */
  setDeletedAt(id: string, deletedAt: string | null): Promise<Row<"events"> | null>;
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
  overriddenFields: string[];
}

export type CreateEventResult =
  | { status: "created"; event: { id: string; slug: string } }
  | { status: "conflict"; on: "calendar_event" | "slug" };

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
  focus: string | null;
  registration: string;
  speakers: string | null;
  host_name: string | null;
  calendar_event_id: string | null;
  deleted_at: string | null;
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
const byStartsAtDesc = (a: EventRow, b: EventRow) => {
  const x = a.starts_at ?? "";
  const y = b.starts_at ?? "";
  return x !== y ? (x < y ? 1 : -1) : a.id < b.id ? -1 : 1;
};
const photoOrder = (a: EventPhotoRow, b: EventPhotoRow) => {
  const ta = a.taken_at ?? null;
  const tb = b.taken_at ?? null;
  if (ta !== tb) return ta === null ? 1 : tb === null ? -1 : ta < tb ? -1 : 1;
  return a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1;
};

/** An event with its count of photos that are not hidden. */
export type EventWithPhotoCount = Row<"events"> & { photo_count: number };

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
    type Page = { data: EventChoice[] | null; error: { message: string } | null };
    return fetchAllRows<EventChoice>(
      (from, to) => this.db.from("events").select("id, title, starts_at").order("starts_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<Page>
    );
  }

  // --- photos ---

  async importedPhotoIds(eventId: string) {
    type Page = { data: { id: string; google_media_item_id: string }[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<{ id: string; google_media_item_id: string }>(
      (from, to) => this.db.from("event_photos").select("id, google_media_item_id").eq("event_id", eventId).order("id").range(from, to) as unknown as PromiseLike<Page>
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
    const { data, error } = await this.db.from("events").select("id, slug, deleted_at, automatic").eq("calendar_event_id", calendarEventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, slug: data.slug, hidden: !!data.deleted_at, automatic: !!data.automatic } : null;
  }

  async calendarEventIdsWithEvent(calendarEventIds: string[]) {
    const have = new Set<string>();
    for (const chunk of chunks(calendarEventIds)) {
      const { data, error } = await this.db.from("events").select("calendar_event_id").in("calendar_event_id", chunk);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) if (row.calendar_event_id) have.add(row.calendar_event_id);
    }
    return have;
  }

  async linkedToCalendarEvents(calendarEventIds: string[]) {
    const out: CalendarFollower[] = [];
    for (const chunk of chunks(calendarEventIds)) {
      const { data, error } = await this.db.from("events").select("id, calendar_event_id, overridden_fields").in("calendar_event_id", chunk).order("id");
      if (error) throw new Error(error.message);
      for (const r of data ?? []) out.push({ id: r.id, calendarEventId: r.calendar_event_id, overriddenFields: r.overridden_fields });
    }
    return out;
  }

  async createFromCalendar(row: Insert<"events">): Promise<CreateEventResult> {
    const { data, error } = await this.db.from("events").insert(row).select("id, slug").single();
    if (!error) return { status: "created", event: { id: data.id, slug: data.slug } };
    if (error.code === "23505") return { status: "conflict", on: error.message.includes("calendar_event_id") ? "calendar_event" : "slug" };
    throw new Error(error.message);
  }

  async update(id: string, fields: Update<"events">) {
    const { error } = await this.db.from("events").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async automaticFollowing(calendarEventIds: string[]) {
    const out: { id: string; calendarEventId: string }[] = [];
    for (const chunk of chunks(calendarEventIds)) {
      const { data, error } = await this.db.from("events").select("id, calendar_event_id").eq("automatic", true).in("calendar_event_id", chunk).order("id");
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (r.calendar_event_id) out.push({ id: r.id, calendarEventId: r.calendar_event_id });
    }
    return out;
  }

  async automaticWithoutCalendarEvent() {
    type Page = { data: { id: string }[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<{ id: string }>(
      (from, to) => this.db.from("events").select("id").eq("automatic", true).is("calendar_event_id", null).order("id").range(from, to) as unknown as PromiseLike<Page>
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
      const { error } = await this.db.from("events").delete().in("id", chunk);
      if (error) throw new Error(error.message);
    }
  }

  // --- member-facing reads ---

  async listWithCover(): Promise<EventListItem[]> {
    type Raw = Omit<EventListItem, "coverPhotoId"> & { event_photos: { id: string; hidden_at: string | null }[] | null };
    type Page = { data: Raw[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("events")
          .select("id, slug, title, event_type, location, starts_at, ends_at, focus, registration, speakers, host_name, calendar_event_id, deleted_at, event_photos(id, hidden_at)")
          .order("starts_at", { ascending: false })
          .order("id")
          .order("taken_at", { referencedTable: "event_photos", ascending: true, nullsFirst: false })
          .order("created_at", { referencedTable: "event_photos", ascending: true })
          .order("id", { referencedTable: "event_photos" })
          .range(from, to) as unknown as PromiseLike<Page>
    );
    return rows.map(({ event_photos, ...e }) => ({ ...e, coverPhotoId: (event_photos ?? []).find((p) => !p.hidden_at)?.id ?? null }));
  }

  async visibleBySlug(slug: string): Promise<Row<"events"> | null> {
    const { data, error } = await this.db.from("events").select("*").eq("slug", slug).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  // --- admin events ---

  async listWithPhotoCounts() {
    type Embedded = Row<"events"> & { event_photos: { id: string; hidden_at: string | null }[] | null };
    type Page = { data: Embedded[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<Embedded>(
      (from, to) => this.db.from("events").select("*, event_photos(id, hidden_at)").order("starts_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<Page>
    );
    return rows.map(({ event_photos, ...event }) => ({ ...event, photo_count: (event_photos ?? []).filter((p) => !p.hidden_at).length }));
  }

  async byId(id: string) {
    const { data, error } = await this.db.from("events").select("*").eq("id", id).maybeSingle();
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
    const { data, error } = await this.db.from("events").select("id").eq("id", eventId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async visibleEndingFrom(eventIds: string[], endsOnOrAfter: string): Promise<FeedEvent[]> {
    const out: FeedEvent[] = [];
    for (const ids of chunk(eventIds, ID_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from("events")
        .select("id, slug, title, speakers, host_name, location, starts_at, ends_at")
        .in("id", ids)
        .is("deleted_at", null)
        .gte("ends_at", endsOnOrAfter);
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
    let query = this.db.from("events").select("id, slug, title, speakers, host_name, event_type, location, starts_at, focus");
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
      .range(q.offset, q.offset + q.limit - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(fields: Insert<"events">) {
    const { data, error } = await this.db.from("events").insert(fields).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async edit(id: string, fields: Update<"events">) {
    const { data, error } = await this.db.from("events").update(fields).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async setDeletedAt(id: string, deletedAt: string | null) {
    const { data, error } = await this.db.from("events").update({ deleted_at: deletedAt }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.from("events").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async allPhotosOf(eventId: string) {
    type Page = { data: Row<"event_photos">[] | null; error: { message: string } | null };
    return fetchAllRows<Row<"event_photos">>(
      (from, to) =>
        this.db
          .from("event_photos")
          .select("*")
          .eq("event_id", eventId)
          .order("taken_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to) as unknown as PromiseLike<Page>
    );
  }

  async photoPaths(eventId: string) {
    type Page = { data: { storage_path: string }[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<{ storage_path: string }>(
      (from, to) => this.db.from("event_photos").select("storage_path").eq("event_id", eventId).order("id").range(from, to) as unknown as PromiseLike<Page>
    );
    return rows.map((r) => r.storage_path);
  }

  async attendeesOf(eventId: string) {
    type Embedded = { id: string; member_id: string; members: EventAttendeeEntry["member"] };
    type Page = { data: Embedded[] | null; error: { message: string } | null };
    const rows = await fetchAllRows<Embedded>(
      (from, to) =>
        this.db
          .from("event_attendees")
          .select("id, member_id, members(name, display_name, email)")
          .eq("event_id", eventId)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to) as unknown as PromiseLike<Page>
    );
    return rows.map((r) => ({ id: r.id, member_id: r.member_id, member: r.members }));
  }

  async visibilityByCalendarEvent(calendarEventIds: string[]) {
    const out = new Map<string, "shown" | "hidden">();
    for (const ids of chunks(calendarEventIds)) {
      const { data, error } = await this.db.from("events").select("calendar_event_id, deleted_at").in("calendar_event_id", ids);
      if (error) throw new Error(error.message);
      for (const e of data ?? []) if (e.calendar_event_id) out.set(e.calendar_event_id, e.deleted_at ? "hidden" : "shown");
    }
    return out;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryEventRepository implements EventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async choices() {
    return this.data.events
      .flatMap((e) => (e.starts_at ? [{ id: e.id, title: e.title, starts_at: e.starts_at }] : []))
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

  async byCalendarEventId(calendarEventId: string) {
    const e = this.data.events.find((x) => x.calendar_event_id === calendarEventId);
    return e ? { id: e.id, slug: e.slug, hidden: !!e.deleted_at, automatic: !!e.automatic } : null;
  }

  async calendarEventIdsWithEvent(calendarEventIds: string[]) {
    const wanted = new Set(calendarEventIds);
    return new Set(this.data.events.flatMap((e) => (e.calendar_event_id && wanted.has(e.calendar_event_id) ? [e.calendar_event_id] : [])));
  }

  async linkedToCalendarEvents(calendarEventIds: string[]) {
    const wanted = new Set(calendarEventIds);
    return this.data.events
      .filter((e) => e.calendar_event_id && wanted.has(e.calendar_event_id))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((e) => ({ id: e.id, calendarEventId: e.calendar_event_id ?? null, overriddenFields: [...(e.overridden_fields ?? [])] }));
  }

  async createFromCalendar(row: Insert<"events">): Promise<CreateEventResult> {
    if (row.calendar_event_id && this.data.events.some((e) => e.calendar_event_id === row.calendar_event_id)) return { status: "conflict", on: "calendar_event" };
    if (this.data.events.some((e) => e.slug === row.slug)) return { status: "conflict", on: "slug" };
    const id = row.id ?? `evnt_mem${this.data.events.length + 1}`;
    this.data.events.push({ overridden_fields: [], automatic: false, deleted_at: null, ...(row as Partial<Row<"events">>), id, title: row.title, slug: row.slug });
    return { status: "created", event: { id, slug: row.slug } };
  }

  async update(id: string, fields: Update<"events">) {
    const e = this.data.events.find((x) => x.id === id);
    if (e) Object.assign(e, fields);
  }

  async automaticFollowing(calendarEventIds: string[]) {
    const wanted = new Set(calendarEventIds);
    return this.data.events
      .flatMap((e) => (e.automatic && e.calendar_event_id && wanted.has(e.calendar_event_id) ? [{ id: e.id, calendarEventId: e.calendar_event_id }] : []))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async automaticWithoutCalendarEvent() {
    return this.data.events.filter((e) => e.automatic && !e.calendar_event_id).map((e) => e.id).sort();
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
    return [...this.data.events].sort(byStartsAtDesc).map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      event_type: e.event_type ?? "other",
      location: e.location ?? null,
      starts_at: e.starts_at ?? "",
      ends_at: e.ends_at ?? e.starts_at ?? "",
      focus: e.focus ?? null,
      registration: e.registration ?? "none",
      speakers: e.speakers ?? null,
      host_name: e.host_name ?? null,
      calendar_event_id: e.calendar_event_id ?? null,
      deleted_at: e.deleted_at ?? null,
      coverPhotoId: this.photosOf(e.id).find((p) => !p.hidden_at)?.id ?? null,
    }));
  }

  async visibleBySlug(slug: string): Promise<Row<"events"> | null> {
    const e = this.data.events.find((row) => row.slug === slug && !row.deleted_at);
    if (!e) return null;
    const startsAt = e.starts_at ?? "";
    return {
      agenda: null,
      announced_publicly: false,
      automatic: false,
      calendar_event_id: null,
      capacity: null,
      created_at: startsAt,
      created_by: null,
      deleted_at: null,
      description: null,
      end_time: null,
      ends_at: startsAt,
      event_type: "other",
      focus: null,
      google_photos_album_url: null,
      guests_allowed: false,
      host_name: null,
      location: null,
      overridden_fields: [],
      registration: "none",
      results: null,
      selection: "first_come",
      speakers: null,
      start_time: null,
      starts_at: startsAt,
      updated_at: startsAt,
      ...e,
    };
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
    return this.data.events
      .filter((e) => wanted.has(e.id) && !e.deleted_at && (e.ends_at ?? "") >= endsOnOrAfter)
      .map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        speakers: e.speakers ?? null,
        host_name: e.host_name ?? null,
        location: e.location ?? null,
        starts_at: e.starts_at ?? "",
        ends_at: e.ends_at ?? "",
      }));
  }

  async search(q: EventSearchQuery): Promise<EventSearchHit[]> {
    const attendedBy = q.attendedBy;
    const attended = attendedBy ? new Set(this.data.eventAttendees.filter((a) => a.member_id !== undefined && attendedBy.includes(a.member_id)).map((a) => a.event_id)) : null;
    if (attended && attended.size === 0) return [];
    const words = q.words.map((w) => searchWord(w).toLowerCase());
    const dayStart = (d: string) => Date.parse(d.slice(0, 10));
    return this.data.events
      .filter((e) => {
        if (attended && !attended.has(e.id)) return false;
        if (!q.includeHidden && e.deleted_at) return false;
        if (q.after && Date.parse(e.starts_at ?? "") < dayStart(q.after)) return false;
        if (q.before && Date.parse(e.starts_at ?? "") >= dayStart(q.before)) return false;
        return words.every((w) => SEARCH_FIELDS.some((f) => (e[f] ?? "").toLowerCase().includes(w)));
      })
      .sort(byStartsAtDesc)
      .slice(q.offset, q.offset + q.limit)
      .map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        speakers: e.speakers ?? null,
        host_name: e.host_name ?? null,
        event_type: e.event_type ?? "other",
        location: e.location ?? null,
        starts_at: e.starts_at ?? "",
        focus: e.focus ?? null,
      }));
  }

  private photosOf(eventId: string) {
    return this.data.eventPhotos.filter((p) => p.event_id === eventId).sort(photoOrder);
  }

  // --- admin events ---

  private nextId = 0;

  // The dataset's event rows leave columns out; the twin hands them back as the full row type, so a column a test did not set is undefined.
  private full(row: EventRow) {
    return { ...row } as Row<"events">;
  }

  async listWithPhotoCounts() {
    return [...this.data.events].sort(byStartsDesc).map((e) => ({
      ...this.full(e),
      photo_count: this.data.eventPhotos.filter((p) => p.event_id === e.id && !p.hidden_at).length,
    }));
  }

  async byId(id: string) {
    const row = this.data.events.find((e) => e.id === id);
    return row ? this.full(row) : null;
  }

  async create(fields: Insert<"events">) {
    if (!fields.slug || !fields.title) throw new Error("null value in column violates not-null constraint");
    const row = { id: `evnt_created${++this.nextId}`, ...fields } as EventRow;
    this.data.events.push(row);
    return this.full(row);
  }

  async edit(id: string, fields: Update<"events">) {
    const row = this.data.events.find((e) => e.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, fields);
    return this.full(row);
  }

  async setDeletedAt(id: string, deletedAt: string | null) {
    const row = this.data.events.find((e) => e.id === id);
    if (!row) return null;
    row.deleted_at = deletedAt;
    return this.full(row);
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
    const wanted = new Set(calendarEventIds);
    const out = new Map<string, "shown" | "hidden">();
    for (const e of this.data.events) if (e.calendar_event_id && wanted.has(e.calendar_event_id)) out.set(e.calendar_event_id, e.deleted_at ? "hidden" : "shown");
    return out;
  }
}
