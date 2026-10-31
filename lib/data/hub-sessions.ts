import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * The schedule of an event made in the Hub, with no Google Calendar item (`hub_sessions`). Writing one
 * projects it into a prickle (source "hub"), which the event stands on like any other. Temporary: this
 * table and its projection go away once events are written back to Google Calendar
 * (docs/TODO.md, "Events and prickles: one schedule, later sub-events and write-back").
 */
export type HubSession = {
  id: string;
  title: string;
  description: string | null;
  /** Member id of the host. */
  hostId: string | null;
  /** A host who is not a member, as written. */
  hostName: string | null;
  guestSpeaker: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  /** The prickle type; null means the event-only "Event" type. */
  typeId: string | null;
  /** The prickle the session is projected into, which an event stands on; null before the first projection. */
  prickleId: string | null;
};

/** A hub session as the in-memory dataset keeps it (the prickle is found through `prickles.hubSessionId`). */
export type HubSessionRow = Omit<HubSession, "prickleId">;

export type NewHubSession = Pick<HubSession, "title" | "startTime" | "endTime"> &
  Partial<Pick<HubSession, "description" | "hostId" | "hostName" | "guestSpeaker" | "location" | "typeId">>;
export type HubSessionPatch = Partial<NewHubSession>;

/**
 * Hub sessions. `create`, `update` and `remove` write the session and then project it into prickles,
 * so the prickle (and an event on it) is current when they return. Every method throws on a database error.
 */
export interface HubSessionRepository {
  /** One session with its prickle id, or null. */
  byId(id: string): Promise<HubSession | null>;
  /** Adds a session and its prickle; returns it with `prickleId` set. */
  create(fields: NewHubSession): Promise<HubSession>;
  /** Changes a session and its prickle; throws when there is no such session. */
  update(id: string, patch: HubSessionPatch): Promise<HubSession>;
  /** Deletes a session and its prickle. Throws while an event stands on the prickle: delete the event first. */
  remove(id: string): Promise<void>;
  /** Projects every session into prickles and deletes hub prickles whose session is gone (idempotent; ids stay stable). */
  project(): Promise<void>;
}

const COLUMNS = "id, title, description, host, host_name, guest_speaker, location, start_time, end_time, type_id";
type SessionColumns = {
  id: string;
  title: string;
  description: string | null;
  host: string | null;
  host_name: string | null;
  guest_speaker: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  type_id: string | null;
};

const toRow = (r: SessionColumns): HubSessionRow => ({
  id: r.id,
  title: r.title,
  description: r.description,
  hostId: r.host,
  hostName: r.host_name,
  guestSpeaker: r.guest_speaker,
  location: r.location,
  startTime: r.start_time,
  endTime: r.end_time,
  typeId: r.type_id,
});

const toColumns = (p: HubSessionPatch) => ({
  ...(p.title !== undefined ? { title: p.title } : {}),
  ...(p.description !== undefined ? { description: p.description } : {}),
  ...(p.hostId !== undefined ? { host: p.hostId } : {}),
  ...(p.hostName !== undefined ? { host_name: p.hostName } : {}),
  ...(p.guestSpeaker !== undefined ? { guest_speaker: p.guestSpeaker } : {}),
  ...(p.location !== undefined ? { location: p.location } : {}),
  ...(p.startTime !== undefined ? { start_time: p.startTime } : {}),
  ...(p.endTime !== undefined ? { end_time: p.endTime } : {}),
  ...(p.typeId !== undefined ? { type_id: p.typeId } : {}),
});

export class SupabaseHubSessionRepository implements HubSessionRepository {
  constructor(private readonly db: Db) {}

  async byId(id: string): Promise<HubSession | null> {
    const { data, error } = await this.db.from("hub_sessions").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...toRow(data), prickleId: await this.prickleOf(id) } : null;
  }

  async create(fields: NewHubSession): Promise<HubSession> {
    const { data, error } = await this.db
      .from("hub_sessions")
      .insert({ ...toColumns(fields), title: fields.title, start_time: fields.startTime, end_time: fields.endTime })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return this.projected(data.id);
  }

  async update(id: string, patch: HubSessionPatch): Promise<HubSession> {
    const columns = toColumns(patch);
    if (Object.keys(columns).length > 0) {
      const { data, error } = await this.db.from("hub_sessions").update(columns).eq("id", id).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`hub session ${id} not found`);
    }
    return this.projected(id);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("hub_sessions").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async project(): Promise<void> {
    const { error } = await this.db.rpc("reprocess_hub_prickles_atomic");
    if (error) throw new Error(error.message);
  }

  private async projected(id: string): Promise<HubSession> {
    await this.project();
    const session = await this.byId(id);
    if (!session) throw new Error(`hub session ${id} not found`);
    return session;
  }

  private async prickleOf(sessionId: string): Promise<string | null> {
    const { data, error } = await this.db.from("prickles").select("id").eq("hub_session_id", sessionId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }
}

/** In-memory twin: projects into the dataset's prickles the way `project_hub_sessions` does. */
export class InMemoryHubSessionRepository implements HubSessionRepository {
  private nextId = 0;
  constructor(private readonly data: InMemoryDataset) {}

  private withPrickle(row: HubSessionRow): HubSession {
    return { ...row, prickleId: this.data.prickles.find((p) => p.hubSessionId === row.id)?.id ?? null };
  }

  async byId(id: string) {
    const row = this.data.hubSessions.find((s) => s.id === id);
    return row ? this.withPrickle(row) : null;
  }

  async create(fields: NewHubSession) {
    if (!(new Date(fields.endTime).getTime() > new Date(fields.startTime).getTime())) throw new Error("violates check constraint hub_sessions_times_check");
    const row: HubSessionRow = {
      id: `hsess_mem${String(++this.nextId).padStart(8, "0")}`,
      description: null,
      hostId: null,
      hostName: null,
      guestSpeaker: null,
      location: null,
      typeId: null,
      ...fields,
    };
    this.data.hubSessions.push(row);
    await this.project();
    return this.withPrickle(row);
  }

  async update(id: string, patch: HubSessionPatch) {
    const row = this.data.hubSessions.find((s) => s.id === id);
    if (!row) throw new Error(`hub session ${id} not found`);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = { ...row, ...defined };
    if (!(new Date(next.endTime).getTime() > new Date(next.startTime).getTime())) throw new Error("violates check constraint hub_sessions_times_check");
    Object.assign(row, next);
    await this.project();
    return this.withPrickle(row);
  }

  async remove(id: string) {
    const prickle = this.data.prickles.find((p) => p.hubSessionId === id);
    if (prickle && this.data.events.some((e) => e.prickle_id === prickle.id)) throw new Error("violates foreign key constraint community_events_prickle_id_fkey");
    this.data.hubSessions = this.data.hubSessions.filter((s) => s.id !== id);
    await this.project();
  }

  async project() {
    const eventType = this.data.prickleTypes.find((t) => t.normalizedName === "event")?.id ?? null;
    for (const s of this.data.hubSessions) {
      const existing = this.data.prickles.find((p) => p.hubSessionId === s.id);
      const fields = {
        typeId: s.typeId ?? eventType,
        hostId: s.hostId,
        title: s.title,
        description: s.description,
        guestSpeaker: s.guestSpeaker,
        location: s.location,
        startTime: s.startTime,
        endTime: s.endTime,
      };
      if (existing) Object.assign(existing, fields);
      else this.data.prickles.push({ id: `prkl_hub${s.id.slice(-8)}`, source: "hub", calendarEventId: null, hubSessionId: s.id, ...fields });
    }
    const live = new Set(this.data.hubSessions.map((s) => s.id));
    this.data.prickles = this.data.prickles.filter((p) => p.source !== "hub" || (p.hubSessionId && live.has(p.hubSessionId)));
  }
}
