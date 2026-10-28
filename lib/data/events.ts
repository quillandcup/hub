import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * An event as the in-memory dataset keeps it. The badges only need `id`, `title` and `slug`; the rest
 * of the database's columns are optional so a test or seed names just the ones it cares about.
 */
export type EventRow = Pick<Row<"events">, "id" | "title" | "slug"> & Partial<Omit<Row<"events">, "id" | "title" | "slug">>;

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
}

export type EventPhotoRow = Row<"event_photos">;
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
}
