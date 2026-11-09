import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** One visit by a signed-in user (`access_events`): a page view, with the place and device it came from. */
export type AccessEventRow = Row<"access_events">;
export type NewAccessEvent = Insert<"access_events">;

/**
 * The page-view log (`access_events`). Written for the signed-in user's own visits; the nightly retention
 * job (lib/retention/network-details.ts) later strips the raw IP and user-agent. Throws on a database error.
 */
export interface AccessEventRepository {
  /** Records a visit. */
  record(event: NewAccessEvent): Promise<void>;
  /**
   * The approximate place (city and ISO country code) of each of one user's sessions: the latest of the session's events
   * that has one. Always scoped to `userId`, so someone else's session id finds nothing. A session with no located
   * event is absent from the map. Never returns the IP address. Needs the service role (admins read the log through RLS).
   */
  placesBySession(userId: string, sessionIds: string[]): Promise<Map<string, SessionPlace>>;
  /** The time of each user's latest event, for every user with one (a user with none is absent). Needs the service role. */
  lastSeenByUser(): Promise<Map<string, string>>;
}

/** The coarse place a session came from, as recorded from the request's geolocation. */
export interface SessionPlace {
  city: string | null;
  /** ISO 3166-1 alpha-2, e.g. "CR". */
  country: string | null;
}

export class SupabaseAccessEventRepository implements AccessEventRepository {
  constructor(private readonly db: Db) {}

  async record(event: NewAccessEvent) {
    const { error } = await this.db.from("access_events").insert(event);
    if (error) throw new Error(error.message);
  }

  async placesBySession(userId: string, sessionIds: string[]) {
    const places = new Map<string, SessionPlace>();
    // One small query per session (a member has a handful), each taking only the latest located event.
    const rows = await Promise.all(
      sessionIds.map(async (sessionId) => {
        const { data, error } = await this.db
          .from("access_events")
          .select("city, country")
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .or("country.not.is.null,city.not.is.null")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw new Error(error.message);
        return [sessionId, data?.[0]] as const;
      }),
    );
    for (const [sessionId, row] of rows) if (row) places.set(sessionId, { city: row.city, country: row.country });
    return places;
  }

  async lastSeenByUser() {
    const { data, error } = await this.db.rpc("last_access_by_user");
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((r) => [r.user_id, r.last_access_at]));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryAccessEventRepository implements AccessEventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async record(event: NewAccessEvent) {
    this.data.accessEvents.push({
      acting_as_member_id: null,
      city: null,
      country: null,
      created_at: new Date().toISOString(),
      device: null,
      ga_client_id: null,
      ip_address: null,
      region: null,
      session_id: null,
      user_agent: null,
      ...event,
      id: this.data.accessEvents.length + 1,
    });
  }

  async placesBySession(userId: string, sessionIds: string[]) {
    const places = new Map<string, SessionPlace>();
    const mine = this.data.accessEvents
      .filter((e) => e.user_id === userId && e.session_id && sessionIds.includes(e.session_id) && (e.city || e.country))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    for (const e of mine) if (!places.has(e.session_id!)) places.set(e.session_id!, { city: e.city, country: e.country });
    return places;
  }

  async lastSeenByUser() {
    const latest = new Map<string, string>();
    for (const e of this.data.accessEvents) {
      const seen = latest.get(e.user_id);
      if (!seen || e.created_at > seen) latest.set(e.user_id, e.created_at);
    }
    return latest;
  }
}
