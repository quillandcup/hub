import { fetchAllRows } from "@/lib/supabase/paginate";
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
}
