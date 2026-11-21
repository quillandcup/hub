import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A Google Calendar item as the Bronze import keeps it (`bronze.calendar_events`). */
export type CalendarSourceEvent = Database["bronze"]["Tables"]["calendar_events"]["Row"];
export type NewCalendarSourceEvent = Database["bronze"]["Tables"]["calendar_events"]["Insert"];
export type CalendarSourceEventPatch = Database["bronze"]["Tables"]["calendar_events"]["Update"];

const ID_CHUNK = 100;

/**
 * The Bronze copy of the Google Calendar: raw items the import upserts on their Google id and the
 * processing turns into prickles and events. Bronze is reprocessable input, so rows are replaced by
 * the import and removed when the calendar drops them. Reads throw on a database error.
 */
export interface CalendarEventRepository {
  /** How many calendar items are stored. */
  count(): Promise<number>;
  /** When the import last touched a row (`imported_at` moves on every sync), or null when empty. */
  lastImportedAt(): Promise<string | null>;
  /** The earliest start and the latest end across everything stored, or null when empty. */
  span(): Promise<{ start: string; end: string } | null>;
  /** One item by its Hub id, or null. */
  byId(id: string): Promise<CalendarSourceEvent | null>;
  /** These items (those that exist). Chunked. */
  byIds(ids: string[]): Promise<CalendarSourceEvent[]>;
  /** Items that overlap a time range (start before its end, end after its start), by start time. Paginated. */
  overlapping(from: string, to: string): Promise<CalendarSourceEvent[]>;
  /** Items starting within a range (both ends included), by start time. Paginated. */
  startingBetween(from: string, to: string): Promise<CalendarSourceEvent[]>;
  /** These items by Google id (those that exist). Chunked. */
  byGoogleIds(googleEventIds: string[]): Promise<CalendarSourceEvent[]>;
  /**
   * Removes these items by Google id (the ones the calendar reports cancelled) and returns what was
   * removed, so the caller knows which dates to reprocess. Dependent rows go with them (ON DELETE
   * CASCADE). Ids we don't store are ignored.
   */
  deleteByGoogleIds(googleEventIds: string[]): Promise<CalendarSourceEvent[]>;
  /** Adds items, or replaces the ones with the same Google id (their Hub ids stay, so links to them keep working). */
  upsert(events: NewCalendarSourceEvent[]): Promise<void>;
  /** Stamps these items (by Google id) as just synced. Chunked; every chunk is tried, then the first failure is thrown. */
  touchImported(googleEventIds: string[], at: string): Promise<void>;
  /** Writes these columns to one item. */
  update(id: string, fields: CalendarSourceEventPatch): Promise<void>;
  /**
   * Removes the items starting in a range (its start included, its end not) whose Google id is not
   * in the list (they left the calendar); returns how many went. Their dependent rows go with them
   * (ON DELETE CASCADE). An empty list deletes nothing, so a bad or empty calendar response can't
   * wipe the table.
   */
  deleteStale(range: { from: string; to: string }, currentGoogleIds: string[]): Promise<number>;
}

export class SupabaseCalendarEventRepository implements CalendarEventRepository {
  constructor(private readonly db: Db) {}

  private get table() {
    return this.db.schema("bronze").from("calendar_events");
  }

  async count() {
    const { count, error } = await this.table.select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async lastImportedAt() {
    const { data, error } = await this.table.select("imported_at").order("imported_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.imported_at ?? null;
  }

  async span() {
    const [first, last] = await Promise.all([
      this.table.select("start_time").order("start_time", { ascending: true }).limit(1).maybeSingle(),
      this.table.select("end_time").order("end_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (first.error) throw new Error(first.error.message);
    if (last.error) throw new Error(last.error.message);
    return first.data && last.data ? { start: first.data.start_time, end: last.data.end_time } : null;
  }

  async byId(id: string) {
    const { data, error } = await this.table.select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async byIds(ids: string[]) {
    const rows: CalendarSourceEvent[] = [];
    for (const part of chunk([...new Set(ids)], ID_CHUNK)) {
      const { data, error } = await this.table.select("*").in("id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async byGoogleIds(googleEventIds: string[]) {
    const rows: CalendarSourceEvent[] = [];
    for (const part of chunk([...new Set(googleEventIds)], ID_CHUNK)) {
      const { data, error } = await this.table.select("*").in("google_event_id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async deleteByGoogleIds(googleEventIds: string[]) {
    const removed: CalendarSourceEvent[] = [];
    for (const part of chunk([...new Set(googleEventIds)], ID_CHUNK)) {
      const { data, error } = await this.table.delete().in("google_event_id", part).select("*");
      if (error) throw new Error(error.message);
      removed.push(...(data ?? []));
    }
    return removed;
  }

  async overlapping(from: string, to: string) {
    return fetchAllRows<CalendarSourceEvent>(
      (a, b) =>
        this.table.select("*").lt("start_time", to).gt("end_time", from).order("start_time").order("id").range(a, b)
    );
  }

  async startingBetween(from: string, to: string) {
    return fetchAllRows<CalendarSourceEvent>(
      (a, b) =>
        this.table.select("*").gte("start_time", from).lte("start_time", to).order("start_time").order("id").range(a, b)
    );
  }

  async upsert(events: NewCalendarSourceEvent[]) {
    if (events.length === 0) return;
    const { error } = await this.table.upsert(events, { onConflict: "google_event_id", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }

  async touchImported(googleEventIds: string[], at: string) {
    let failure: Error | null = null;
    for (const part of chunk(googleEventIds, ID_CHUNK)) {
      const { error } = await this.table.update({ imported_at: at }).in("google_event_id", part);
      if (error && !failure) failure = new Error(error.message);
    }
    if (failure) throw failure;
  }

  async update(id: string, fields: CalendarSourceEventPatch) {
    const { error } = await this.table.update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async deleteStale({ from, to }: { from: string; to: string }, currentGoogleIds: string[]) {
    // A SECURITY DEFINER function, so it works whatever the caller's role.
    const { data, error } = await this.db.rpc("delete_stale_calendar_events", { p_time_min: from, p_time_max: to, p_current_google_ids: currentGoogleIds });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryCalendarEventRepository implements CalendarEventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private byStart(rows: CalendarSourceEvent[]) {
    return [...rows].sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id < b.id ? -1 : 1));
  }

  async count() {
    return this.data.calendarEvents.length;
  }

  async lastImportedAt() {
    const times = this.data.calendarEvents.flatMap((e) => (e.imported_at ? [e.imported_at] : []));
    return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }

  async span() {
    if (this.data.calendarEvents.length === 0) return null;
    const starts = this.data.calendarEvents.map((e) => e.start_time);
    const ends = this.data.calendarEvents.map((e) => e.end_time);
    return { start: starts.reduce((a, b) => (a < b ? a : b)), end: ends.reduce((a, b) => (a > b ? a : b)) };
  }

  async byId(id: string) {
    const e = this.data.calendarEvents.find((x) => x.id === id);
    return e ? { ...e } : null;
  }

  async byIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.data.calendarEvents.filter((e) => wanted.has(e.id)).map((e) => ({ ...e }));
  }

  async byGoogleIds(googleEventIds: string[]) {
    const wanted = new Set(googleEventIds);
    return this.data.calendarEvents.filter((e) => wanted.has(e.google_event_id)).map((e) => ({ ...e }));
  }

  async deleteByGoogleIds(googleEventIds: string[]) {
    const wanted = new Set(googleEventIds);
    const removed = this.data.calendarEvents.filter((e) => wanted.has(e.google_event_id));
    this.data.calendarEvents = this.data.calendarEvents.filter((e) => !wanted.has(e.google_event_id));
    return removed.map((e) => ({ ...e }));
  }

  async overlapping(from: string, to: string) {
    return this.byStart(this.data.calendarEvents.filter((e) => e.start_time < to && e.end_time > from)).map((e) => ({ ...e }));
  }

  async startingBetween(from: string, to: string) {
    return this.byStart(this.data.calendarEvents.filter((e) => e.start_time >= from && e.start_time <= to)).map((e) => ({ ...e }));
  }

  async upsert(events: NewCalendarSourceEvent[]) {
    for (const e of events) {
      const existing = this.data.calendarEvents.find((x) => x.google_event_id === e.google_event_id);
      if (existing) {
        Object.assign(existing, e, { id: existing.id });
      } else {
        this.data.calendarEvents.push({
          id: e.id ?? `cal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
          creator_email: null,
          creator_name: null,
          description: null,
          imported_at: null,
          location: null,
          organizer_email: null,
          organizer_name: null,
          summary: null,
          ...e,
        });
      }
    }
  }

  async touchImported(googleEventIds: string[], at: string) {
    const wanted = new Set(googleEventIds);
    for (const e of this.data.calendarEvents) if (wanted.has(e.google_event_id)) e.imported_at = at;
  }

  async update(id: string, fields: CalendarSourceEventPatch) {
    const e = this.data.calendarEvents.find((x) => x.id === id);
    if (e) Object.assign(e, fields);
  }

  async deleteStale({ from, to }: { from: string; to: string }, currentGoogleIds: string[]) {
    if (currentGoogleIds.length === 0) return 0;
    const keep = new Set(currentGoogleIds);
    const before = this.data.calendarEvents.length;
    this.data.calendarEvents = this.data.calendarEvents.filter((e) => !(e.start_time >= from && e.start_time < to && !keep.has(e.google_event_id)));
    return before - this.data.calendarEvents.length;
  }
}
