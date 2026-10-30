import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** One row of Zoom's participant report as the Bronze import keeps it (`bronze.zoom_attendees`). */
export type ZoomAttendeeRow = Database["bronze"]["Tables"]["zoom_attendees"]["Row"];
export type NewZoomAttendee = Database["bronze"]["Tables"]["zoom_attendees"]["Insert"];
/** A meeting as the Bronze import keeps it (`bronze.zoom_meetings`). */
export type ZoomMeetingRow = Database["bronze"]["Tables"]["zoom_meetings"]["Row"];
export type NewZoomMeeting = Database["bronze"]["Tables"]["zoom_meetings"]["Insert"];
/** A Zoom name an admin ignores everywhere (`ignored_zoom_names`). */
export type IgnoredZoomNameRow = Database["public"]["Tables"]["ignored_zoom_names"]["Row"];

/** What name matching reads of an attendee row. */
export type ZoomAttendeeRef = Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid" | "join_time" | "leave_time">;
/** One appearance of a name, with enough to say when and where. */
export type ZoomNameAppearance = Pick<ZoomAttendeeRow, "name" | "email" | "join_time" | "topic" | "meeting_uuid" | "meeting_id">;

const PAGE_CHUNK = 100;
const SESSION_CHUNK = 50;
const WRITE_CHUNK = 500;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * The Bronze copy of Zoom's attendance (`bronze.zoom_attendees`, `bronze.zoom_meetings`) and the
 * names admins ignore (`ignored_zoom_names`). The import upserts attendees on (meeting uuid, name,
 * join time) and meetings on their uuid, so a re-import never duplicates. `zoom_attendees` is large:
 * every read that can pass 1000 rows pages through a stable order and every id list is chunked.
 * Reads and writes throw on a database error.
 */
export interface ZoomRepository {
  // --- attendees ---
  /** How many attendee rows are stored (a person who rejoined has several). */
  attendeeCount(): Promise<number>;
  /**
   * Every attendee row, the columns name matching reads, in id order. `withMeetingOnly` leaves out
   * rows with no meeting uuid (the attendance run can't group them).
   */
  attendeesForMatching(options?: { withMeetingOnly?: boolean }): Promise<ZoomAttendeeRef[]>;
  /** Name, email and meeting uuid of the rows that joined at or after an instant, in id order. */
  attendeesSince(from: string): Promise<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid">[]>;
  /** Name and email of the rows whose stay overlaps a range (joined before its end, left after its start), in id order. */
  attendeeNamesOverlapping(from: string, to: string): Promise<Pick<ZoomAttendeeRow, "name" | "email">[]>;
  /** The full rows whose stay overlaps a range, by join time then id. */
  attendeesOverlapping(from: string, to: string): Promise<ZoomAttendeeRow[]>;
  /** Every appearance of these names, in id order. Chunked. */
  appearancesOf(names: string[]): Promise<ZoomNameAppearance[]>;
  /** For each of these names, in how many distinct meetings it appears (rows with no meeting uuid don't count). A name never seen is left out. */
  meetingCountsByName(names: string[]): Promise<Map<string, number>>;
  /** The distinct meeting uuids one name appears in (rows with no meeting uuid are left out). */
  meetingUuidsForName(name: string): Promise<string[]>;
  /**
   * Who was in these sessions, by session key (a meeting's uuid, or its id for rows with no uuid,
   * the key the attendance run groups by). Each row is listed once. Keys with nobody are left out.
   */
  attendeesInSessions(sessionKeys: string[]): Promise<Map<string, { name: string; email: string | null }[]>>;
  /** Adds attendee rows, or updates the ones with the same (meeting uuid, name, join time). Written in chunks. */
  upsertAttendees(rows: NewZoomAttendee[]): Promise<void>;

  // --- meetings ---
  /** The start of the most recent imported meeting, or null when none is. */
  latestMeetingStart(): Promise<string | null>;
  /** Adds a meeting or updates the one with the same uuid. */
  upsertMeeting(meeting: NewZoomMeeting): Promise<void>;
  /** Zoom host ids of the meetings that started at or after an instant (the rooms the import covers). */
  importedHostIds(since: string): Promise<Set<string>>;

  // --- ignored names ---
  /** Every Zoom name ignored everywhere. */
  ignoredNames(): Promise<string[]>;
  /** Ignores a name everywhere. Throws when it is already ignored. */
  ignoreName(input: { zoomName: string; reason: string | null; ignoredBy: string | null }): Promise<void>;
  /** Stops ignoring a name. */
  unignoreName(zoomName: string): Promise<void>;
}

export class SupabaseZoomRepository implements ZoomRepository {
  constructor(private readonly db: Db) {}

  private get attendees() {
    return this.db.schema("bronze").from("zoom_attendees");
  }

  private get meetings() {
    return this.db.schema("bronze").from("zoom_meetings");
  }

  private get ignored() {
    return this.db.from("ignored_zoom_names");
  }

  async attendeeCount() {
    const { count, error } = await this.attendees.select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async attendeesForMatching({ withMeetingOnly = false }: { withMeetingOnly?: boolean } = {}) {
    return fetchAllRows<ZoomAttendeeRef>((a, b) => {
      let query = this.attendees.select("name, email, meeting_uuid, join_time, leave_time");
      if (withMeetingOnly) query = query.not("meeting_uuid", "is", null);
      return query.order("id").range(a, b) as unknown as Page<ZoomAttendeeRef>;
    });
  }

  async attendeesSince(from: string) {
    return fetchAllRows<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid">>(
      (a, b) => this.attendees.select("name, email, meeting_uuid").gte("join_time", from).order("id").range(a, b) as unknown as Page<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid">>
    );
  }

  async attendeeNamesOverlapping(from: string, to: string) {
    return fetchAllRows<Pick<ZoomAttendeeRow, "name" | "email">>(
      (a, b) =>
        this.attendees.select("name, email").lt("join_time", to).gt("leave_time", from).order("id").range(a, b) as unknown as Page<Pick<ZoomAttendeeRow, "name" | "email">>
    );
  }

  async attendeesOverlapping(from: string, to: string) {
    return fetchAllRows<ZoomAttendeeRow>(
      (a, b) => this.attendees.select("*").lt("join_time", to).gt("leave_time", from).order("join_time").order("id").range(a, b) as unknown as Page<ZoomAttendeeRow>
    );
  }

  async appearancesOf(names: string[]) {
    const rows: ZoomNameAppearance[] = [];
    for (const part of chunk([...new Set(names)], PAGE_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<ZoomNameAppearance>(
          (a, b) =>
            this.attendees.select("name, email, join_time, topic, meeting_uuid, meeting_id").in("name", part).order("id").range(a, b) as unknown as Page<ZoomNameAppearance>
        ))
      );
    }
    return rows;
  }

  async meetingCountsByName(names: string[]) {
    const meetings = new Map<string, Set<string>>();
    for (const part of chunk([...new Set(names)], PAGE_CHUNK)) {
      const rows = await fetchAllRows<{ name: string; meeting_uuid: string | null }>(
        (a, b) =>
          this.attendees.select("name, meeting_uuid").in("name", part).not("meeting_uuid", "is", null).order("id").range(a, b) as unknown as Page<{
            name: string;
            meeting_uuid: string | null;
          }>
      );
      for (const r of rows) {
        if (!r.meeting_uuid) continue;
        const set = meetings.get(r.name) ?? new Set<string>();
        set.add(r.meeting_uuid);
        meetings.set(r.name, set);
      }
    }
    return new Map([...meetings].map(([name, set]) => [name, set.size]));
  }

  async meetingUuidsForName(name: string) {
    const rows = await fetchAllRows<{ meeting_uuid: string | null }>(
      (a, b) => this.attendees.select("meeting_uuid").eq("name", name).not("meeting_uuid", "is", null).order("id").range(a, b) as unknown as Page<{ meeting_uuid: string | null }>
    );
    return [...new Set(rows.flatMap((r) => (r.meeting_uuid ? [r.meeting_uuid] : [])))];
  }

  async attendeesInSessions(sessionKeys: string[]) {
    type Row = Pick<ZoomAttendeeRow, "id" | "name" | "email" | "meeting_uuid" | "meeting_id">;
    const result = new Map<string, { name: string; email: string | null }[]>();
    const seen = new Set<string>();
    for (const part of chunk([...new Set(sessionKeys)], SESSION_CHUNK)) {
      // The attendance run groups by meeting_uuid, falling back to meeting_id; look up both.
      for (const column of ["meeting_uuid", "meeting_id"] as const) {
        const rows = await fetchAllRows<Row>(
          (a, b) => this.attendees.select("id, name, email, meeting_uuid, meeting_id").in(column, part).order("id").range(a, b) as unknown as Page<Row>
        );
        for (const r of rows) {
          const key = r.meeting_uuid || r.meeting_id;
          if (!part.includes(key) || seen.has(r.id)) continue;
          seen.add(r.id);
          result.set(key, [...(result.get(key) ?? []), { name: r.name, email: r.email }]);
        }
      }
    }
    return result;
  }

  async upsertAttendees(rows: NewZoomAttendee[]) {
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.attendees.upsert(part, { onConflict: "meeting_uuid,name,join_time", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
    }
  }

  async latestMeetingStart() {
    const { data, error } = await this.meetings.select("start_time").order("start_time", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.start_time ?? null;
  }

  async upsertMeeting(meeting: NewZoomMeeting) {
    const { error } = await this.meetings.upsert(meeting, { onConflict: "meeting_uuid", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }

  async importedHostIds(since: string) {
    const rows = await fetchAllRows<{ host_id: string | null }>(
      (a, b) => this.meetings.select("id, host_id:data->>host_id").gte("start_time", since).order("id").range(a, b) as unknown as Page<{ host_id: string | null }>
    );
    return new Set(rows.flatMap((r) => (r.host_id ? [r.host_id] : [])));
  }

  async ignoredNames() {
    const rows = await fetchAllRows<{ zoom_name: string }>((a, b) => this.ignored.select("zoom_name").order("id").range(a, b) as unknown as Page<{ zoom_name: string }>);
    return rows.map((r) => r.zoom_name);
  }

  async ignoreName({ zoomName, reason, ignoredBy }: { zoomName: string; reason: string | null; ignoredBy: string | null }) {
    const { error } = await this.ignored.insert({ zoom_name: zoomName, reason, ignored_by: ignoredBy });
    if (error) throw new Error(error.message);
  }

  async unignoreName(zoomName: string) {
    const { error } = await this.ignored.delete().eq("zoom_name", zoomName);
    if (error) throw new Error(error.message);
  }
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryZoomRepository implements ZoomRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async attendeeCount() {
    return this.data.zoomAttendees.length;
  }

  async attendeesForMatching({ withMeetingOnly = false }: { withMeetingOnly?: boolean } = {}) {
    return byId(this.data.zoomAttendees)
      .filter((a) => !withMeetingOnly || a.meeting_uuid !== null)
      .map(({ name, email, meeting_uuid, join_time, leave_time }) => ({ name, email, meeting_uuid, join_time, leave_time }));
  }

  async attendeesSince(from: string) {
    return byId(this.data.zoomAttendees)
      .filter((a) => a.join_time >= from)
      .map(({ name, email, meeting_uuid }) => ({ name, email, meeting_uuid }));
  }

  async attendeeNamesOverlapping(from: string, to: string) {
    return byId(this.data.zoomAttendees)
      .filter((a) => a.join_time < to && a.leave_time > from)
      .map(({ name, email }) => ({ name, email }));
  }

  async attendeesOverlapping(from: string, to: string) {
    return [...this.data.zoomAttendees]
      .filter((a) => a.join_time < to && a.leave_time > from)
      .sort((a, b) => (a.join_time < b.join_time ? -1 : a.join_time > b.join_time ? 1 : a.id < b.id ? -1 : 1))
      .map((a) => ({ ...a }));
  }

  async appearancesOf(names: string[]) {
    const wanted = new Set(names);
    return byId(this.data.zoomAttendees)
      .filter((a) => wanted.has(a.name))
      .map(({ name, email, join_time, topic, meeting_uuid, meeting_id }) => ({ name, email, join_time, topic, meeting_uuid, meeting_id }));
  }

  async meetingCountsByName(names: string[]) {
    const wanted = new Set(names);
    const meetings = new Map<string, Set<string>>();
    for (const a of this.data.zoomAttendees) {
      if (!wanted.has(a.name) || !a.meeting_uuid) continue;
      meetings.set(a.name, (meetings.get(a.name) ?? new Set()).add(a.meeting_uuid));
    }
    return new Map([...meetings].map(([name, set]) => [name, set.size]));
  }

  async meetingUuidsForName(name: string) {
    return [...new Set(byId(this.data.zoomAttendees).flatMap((a) => (a.name === name && a.meeting_uuid ? [a.meeting_uuid] : [])))];
  }

  async attendeesInSessions(sessionKeys: string[]) {
    const wanted = new Set(sessionKeys);
    const result = new Map<string, { name: string; email: string | null }[]>();
    for (const a of byId(this.data.zoomAttendees)) {
      const key = a.meeting_uuid || a.meeting_id;
      if (!wanted.has(key)) continue;
      result.set(key, [...(result.get(key) ?? []), { name: a.name, email: a.email }]);
    }
    return result;
  }

  async upsertAttendees(rows: NewZoomAttendee[]) {
    for (const r of rows) {
      // The database's unique index never matches a row with no meeting uuid (null is distinct).
      const existing = r.meeting_uuid ? this.data.zoomAttendees.find((x) => x.meeting_uuid === r.meeting_uuid && x.name === r.name && x.join_time === r.join_time) : undefined;
      if (existing) {
        Object.assign(existing, r, { id: existing.id });
      } else {
        this.data.zoomAttendees.push({
          id: r.id ?? crypto.randomUUID(),
          attentiveness_score: null,
          created_at: null,
          email: null,
          failover: null,
          meeting_uuid: null,
          participant_id: null,
          raw_payload: null,
          registrant_id: null,
          status: null,
          topic: null,
          user_id: null,
          ...r,
        });
      }
    }
  }

  async latestMeetingStart() {
    const starts = this.data.zoomMeetings.map((m) => m.start_time);
    return starts.length ? starts.reduce((a, b) => (a > b ? a : b)) : null;
  }

  async upsertMeeting(meeting: NewZoomMeeting) {
    const existing = this.data.zoomMeetings.find((m) => m.meeting_uuid === meeting.meeting_uuid);
    if (existing) {
      Object.assign(existing, meeting, { id: existing.id });
    } else {
      this.data.zoomMeetings.push({
        id: meeting.id ?? crypto.randomUUID(),
        duration_minutes: null,
        end_time: null,
        host_email: null,
        host_name: null,
        imported_at: null,
        participant_count: null,
        updated_at: null,
        ...meeting,
      });
    }
  }

  async importedHostIds(since: string) {
    const hosts = this.data.zoomMeetings
      .filter((m) => m.start_time >= since)
      .map((m) => (m.data && typeof m.data === "object" && !Array.isArray(m.data) ? m.data.host_id : null))
      .flatMap((h) => (typeof h === "string" && h ? [h] : []));
    return new Set(hosts);
  }

  async ignoredNames() {
    return byId(this.data.ignoredZoomNames).map((r) => r.zoom_name);
  }

  async ignoreName({ zoomName, reason, ignoredBy }: { zoomName: string; reason: string | null; ignoredBy: string | null }) {
    if (this.data.ignoredZoomNames.some((r) => r.zoom_name === zoomName)) throw new Error(`${zoomName} is already ignored`);
    this.data.ignoredZoomNames.push({ id: crypto.randomUUID(), zoom_name: zoomName, reason, ignored_by: ignoredBy, ignored_at: null, created_at: null });
  }

  async unignoreName(zoomName: string) {
    this.data.ignoredZoomNames = this.data.ignoredZoomNames.filter((r) => r.zoom_name !== zoomName);
  }
}
