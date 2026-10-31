import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { upsertInChunks } from "./query";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

type UnmatchedTable = Database["public"]["Tables"]["unmatched_calendar_events"];

/** A calendar item's decision row (`unmatched_calendar_events`): queued for review, then resolved or ignored by an admin. */
export type UnmatchedEvent = UnmatchedTable["Row"];
export type NewUnmatchedEvent = UnmatchedTable["Insert"];
export type UnmatchedEventPatch = UnmatchedTable["Update"];

/** A row of the review queue, with the suggestion the processing made. */
export type PendingUnmatchedEvent = Pick<UnmatchedEvent, "id" | "calendar_event_id" | "raw_summary" | "suggested_type" | "suggested_host" | "status" | "created_at">;

/** A queued item that has been resolved or ignored: what processing applies on every run. */
export type UnmatchedEventDecision = Pick<
  UnmatchedEvent,
  "calendar_event_id" | "status" | "resolved_type_id" | "resolved_host_id" | "resolved_title" | "resolved_description" | "resolved_guest_speaker" | "resolved_location"
>;

/** What an admin has set by hand for one calendar item. */
export type UnmatchedEventValues = Pick<UnmatchedEvent, "resolved_type_id" | "resolved_host_id" | "resolved_title" | "resolved_description" | "resolved_guest_speaker" | "resolved_location">;

const PENDING_COLUMNS = "id, calendar_event_id, raw_summary, suggested_type, suggested_host, status, created_at";
const DECISION_COLUMNS = "calendar_event_id, status, resolved_type_id, resolved_host_id, resolved_title, resolved_description, resolved_guest_speaker, resolved_location";
const VALUE_COLUMNS = "resolved_type_id, resolved_host_id, resolved_title, resolved_description, resolved_guest_speaker, resolved_location";
// Small chunks: long `.in()` lists fail with "URI too long".
const ID_CHUNK = 100;

/**
 * The review queue of calendar items whose type the processing could not tell, and the decisions
 * admins made on them (type, host, title...), which the processing applies again on every run.
 * Local data: this table is the source of truth for those decisions and is not reprocessed. Reads and
 * writes throw on a database error; the bulk writes try every chunk and then throw the first failure.
 */
export interface UnmatchedEventRepository {
  /** How many items wait for review. */
  countPending(): Promise<number>;
  /** Everything waiting for review, newest first. Paginated. */
  pending(): Promise<PendingUnmatchedEvent[]>;
  /** Up to `limit` items still waiting that were queued before this time, oldest first. */
  pendingQueuedBefore(before: string, limit: number): Promise<Pick<UnmatchedEvent, "id" | "raw_summary" | "created_at">[]>;
  /** Every resolved or ignored item (the decisions to apply). Paginated. */
  decisions(): Promise<UnmatchedEventDecision[]>;
  /** What was set by hand for one calendar item, or null when it has no row. */
  valuesFor(calendarEventId: string): Promise<UnmatchedEventValues | null>;
  /** Whether a calendar item has a row. */
  existsForCalendarEvent(calendarEventId: string): Promise<boolean>;
  /** Writes these columns to a calendar item's row. */
  updateForCalendarEvent(calendarEventId: string, fields: UnmatchedEventPatch): Promise<void>;
  /** Adds a row. */
  insert(row: NewUnmatchedEvent): Promise<void>;
  /** Marks these rows resolved with this type. Chunked. */
  markResolved(ids: string[], typeId: string, at: string): Promise<void>;
  /** Marks these rows ignored. Chunked. */
  markIgnored(ids: string[], at: string): Promise<void>;
  /** Removes the rows still waiting for review for these calendar items (decisions are kept). Chunked. */
  deletePendingForCalendarEvents(calendarEventIds: string[]): Promise<void>;
  /** Queues items for review, or replaces the row of an item already queued. Chunked and run in parallel. */
  queue(rows: NewUnmatchedEvent[]): Promise<void>;
}

/** Runs every chunk, then throws the first failure. */
async function eachChunk<T>(items: T[], run: (part: T[]) => PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  let failure: string | null = null;
  for (const part of chunk(items, ID_CHUNK)) {
    const { error } = await run(part);
    if (error && failure === null) failure = error.message;
  }
  if (failure !== null) throw new Error(failure);
}

export class SupabaseUnmatchedEventRepository implements UnmatchedEventRepository {
  constructor(private readonly db: Db) {}

  private get table() {
    return this.db.from("unmatched_calendar_events");
  }

  async countPending() {
    const { count, error } = await this.table.select("*", { count: "exact", head: true }).eq("status", "pending");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async pending() {
    return fetchAllRows<PendingUnmatchedEvent>(
      (from, to) => this.table.select(PENDING_COLUMNS).eq("status", "pending").order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: PendingUnmatchedEvent[] | null; error: { message: string } | null }>
    );
  }

  async pendingQueuedBefore(before: string, limit: number) {
    const { data, error } = await this.table.select("id, raw_summary, created_at").eq("status", "pending").lt("created_at", before).order("created_at").order("id").limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async decisions() {
    return fetchAllRows<UnmatchedEventDecision>(
      (from, to) => this.table.select(DECISION_COLUMNS).in("status", ["resolved", "ignored"]).order("id").range(from, to) as unknown as PromiseLike<{ data: UnmatchedEventDecision[] | null; error: { message: string } | null }>
    );
  }

  async valuesFor(calendarEventId: string) {
    const { data, error } = await this.table.select(VALUE_COLUMNS).eq("calendar_event_id", calendarEventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async existsForCalendarEvent(calendarEventId: string) {
    const { data, error } = await this.table.select("id").eq("calendar_event_id", calendarEventId);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async updateForCalendarEvent(calendarEventId: string, fields: UnmatchedEventPatch) {
    const { error } = await this.table.update(fields).eq("calendar_event_id", calendarEventId);
    if (error) throw new Error(error.message);
  }

  async insert(row: NewUnmatchedEvent) {
    const { error } = await this.table.insert(row);
    if (error) throw new Error(error.message);
  }

  async markResolved(ids: string[], typeId: string, at: string) {
    await eachChunk(ids, (part) => this.table.update({ status: "resolved", resolved_type_id: typeId, resolved_at: at }).in("id", part));
  }

  async markIgnored(ids: string[], at: string) {
    await eachChunk(ids, (part) => this.table.update({ status: "ignored", resolved_at: at }).in("id", part));
  }

  async deletePendingForCalendarEvents(calendarEventIds: string[]) {
    await eachChunk(calendarEventIds, (part) => this.table.delete().in("calendar_event_id", part).eq("status", "pending"));
  }

  async queue(rows: NewUnmatchedEvent[]) {
    await upsertInChunks(this.table, rows, "calendar_event_id", ID_CHUNK, Number.POSITIVE_INFINITY);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryUnmatchedEventRepository implements UnmatchedEventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private get rows() {
    return this.data.unmatchedEvents;
  }

  private pendingRows() {
    return this.rows.filter((r) => r.status === "pending");
  }

  /** As in SQL: a null time sorts before any time when descending. */
  private newestFirst(a: UnmatchedEvent, b: UnmatchedEvent) {
    const x = a.created_at ?? "";
    const y = b.created_at ?? "";
    if (x !== y) return a.created_at === null ? -1 : b.created_at === null ? 1 : x < y ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  }

  async countPending() {
    return this.pendingRows().length;
  }

  async pending() {
    return [...this.pendingRows()]
      .sort((a, b) => this.newestFirst(a, b))
      .map(({ id, calendar_event_id, raw_summary, suggested_type, suggested_host, status, created_at }) => ({ id, calendar_event_id, raw_summary, suggested_type, suggested_host, status, created_at }));
  }

  async pendingQueuedBefore(before: string, limit: number) {
    // As in SQL, a null time is not before anything.
    return this.pendingRows()
      .filter((r) => r.created_at !== null && new Date(r.created_at).getTime() < new Date(before).getTime())
      .sort((a, b) => (a.created_at! < b.created_at! ? -1 : a.created_at! > b.created_at! ? 1 : a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(({ id, raw_summary, created_at }) => ({ id, raw_summary, created_at }));
  }

  async decisions() {
    return this.rows
      .filter((r) => r.status === "resolved" || r.status === "ignored")
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(({ calendar_event_id, status, resolved_type_id, resolved_host_id, resolved_title, resolved_description, resolved_guest_speaker, resolved_location }) => ({
        calendar_event_id,
        status,
        resolved_type_id,
        resolved_host_id,
        resolved_title,
        resolved_description,
        resolved_guest_speaker,
        resolved_location,
      }));
  }

  async valuesFor(calendarEventId: string) {
    const row = this.rows.find((r) => r.calendar_event_id === calendarEventId);
    if (!row) return null;
    const { resolved_type_id, resolved_host_id, resolved_title, resolved_description, resolved_guest_speaker, resolved_location } = row;
    return { resolved_type_id, resolved_host_id, resolved_title, resolved_description, resolved_guest_speaker, resolved_location };
  }

  async existsForCalendarEvent(calendarEventId: string) {
    return this.rows.some((r) => r.calendar_event_id === calendarEventId);
  }

  async updateForCalendarEvent(calendarEventId: string, fields: UnmatchedEventPatch) {
    for (const row of this.rows) if (row.calendar_event_id === calendarEventId) Object.assign(row, fields);
  }

  async insert(row: NewUnmatchedEvent) {
    if (this.rows.some((r) => r.calendar_event_id === row.calendar_event_id)) throw new Error("duplicate key value violates unique constraint");
    this.rows.push(this.full(row));
  }

  private full(row: NewUnmatchedEvent): UnmatchedEvent {
    return {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_description: null,
      resolved_guest_speaker: null,
      resolved_location: null,
      resolved_host_id: null,
      resolved_title: null,
      resolved_type_id: null,
      status: "pending",
      suggested_host: null,
      suggested_type: null,
      ...row,
    };
  }

  async markResolved(ids: string[], typeId: string, at: string) {
    for (const row of this.rows) if (ids.includes(row.id)) Object.assign(row, { status: "resolved", resolved_type_id: typeId, resolved_at: at });
  }

  async markIgnored(ids: string[], at: string) {
    for (const row of this.rows) if (ids.includes(row.id)) Object.assign(row, { status: "ignored", resolved_at: at });
  }

  async deletePendingForCalendarEvents(calendarEventIds: string[]) {
    const gone = new Set(calendarEventIds);
    this.data.unmatchedEvents = this.rows.filter((r) => !(r.status === "pending" && gone.has(r.calendar_event_id)));
  }

  async queue(rows: NewUnmatchedEvent[]) {
    for (const row of rows) {
      const existing = this.rows.find((r) => r.calendar_event_id === row.calendar_event_id);
      // As an upsert: only the columns given are replaced, and the row keeps its id.
      if (existing) Object.assign(existing, row, { id: existing.id });
      else this.rows.push(this.full(row));
    }
  }
}
