import { fetchAllRows } from "@/lib/supabase/paginate";
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
  /**
   * What the CSP health check (lib/csp-health.ts) reads: for each user and user agent seen in [since, until), the
   * requests the proxy recorded, the beacon page views, and how many of those carried the `_ga` cookie, plus the
   * user's page views with the cookie in [historySince, since). Aggregated in SQL (one row per user and user agent,
   * not per request); paged because a busy week has more than 1000. Needs the service role.
   */
  activityForCspHealth(window: { since: Date; until: Date; historySince: Date }): Promise<AccessActivityRow[]>;
}

/** One user's activity from one user agent in a window (`AccessEventRepository.activityForCspHealth`). */
export interface AccessActivityRow {
  userId: string;
  userAgent: string | null;
  requests: number;
  /**
   * Of the requests, those only running scripts produce: calls to our own API (not the image routes) and a burst of
   * three or more different pages in one second (the router prefetching links). A tab left open for days has them
   * without a page view; a browser that never runs our scripts has none.
   */
  scriptRequests: number;
  pageViews: number;
  pageViewsWithGa: number;
  /** The user's page views with the cookie in the history window; the same on each of their rows. */
  historyPageViewsWithGa: number;
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

  async activityForCspHealth({ since, until, historySince }: { since: Date; until: Date; historySince: Date }) {
    const rows = await fetchAllRows((from, to) =>
      this.db
        .rpc("csp_rollout_activity", { p_since: since.toISOString(), p_until: until.toISOString(), p_history_since: historySince.toISOString() })
        .range(from, to),
    );
    return rows.map((r) => ({
      userId: r.user_id,
      userAgent: r.user_agent,
      requests: Number(r.requests),
      scriptRequests: Number(r.script_requests),
      pageViews: Number(r.page_views),
      pageViewsWithGa: Number(r.page_views_with_ga),
      historyPageViewsWithGa: Number(r.history_page_views_with_ga),
    }));
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
      ga_tag_state: null,
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

  async activityForCspHealth({ since, until, historySince }: { since: Date; until: Date; historySince: Date }) {
    const at = (e: { created_at: string }) => Date.parse(e.created_at);
    const history = new Map<string, number>();
    for (const e of this.data.accessEvents) {
      if (e.is_page && e.ga_client_id && at(e) >= historySince.getTime() && at(e) < since.getTime()) history.set(e.user_id, (history.get(e.user_id) ?? 0) + 1);
    }
    const inWindow = this.data.accessEvents.filter((e) => at(e) >= since.getTime() && at(e) < until.getTime());
    // The same rules as the SQL function: API calls (not the image routes), and three or more pages in one second.
    const isApi = (path: string) => path.startsWith("/api/");
    const isImage = (path: string) => path.startsWith("/api/media/") || path.startsWith("/api/chat/unfurl-image");
    const pagesPerSecond = new Map<string, Set<string>>();
    for (const e of inWindow) {
      if (e.is_page || isApi(e.path)) continue;
      const key = `${e.user_id}\u0000${Math.floor(at(e) / 1000)}`;
      pagesPerSecond.set(key, (pagesPerSecond.get(key) ?? new Set()).add(e.path));
    }
    const rows = new Map<string, AccessActivityRow>();
    for (const e of inWindow) {
      const key = `${e.user_id}\u0000${e.user_agent ?? ""}`;
      const row = rows.get(key) ?? {
        userId: e.user_id,
        userAgent: e.user_agent,
        requests: 0,
        scriptRequests: 0,
        pageViews: 0,
        pageViewsWithGa: 0,
        historyPageViewsWithGa: history.get(e.user_id) ?? 0,
      };
      if (e.is_page) row.pageViews += 1;
      else {
        row.requests += 1;
        const burst = (pagesPerSecond.get(`${e.user_id}\u0000${Math.floor(at(e) / 1000)}`)?.size ?? 0) >= 3;
        if (isApi(e.path) ? !isImage(e.path) : burst) row.scriptRequests += 1;
      }
      if (e.is_page && e.ga_client_id) row.pageViewsWithGa += 1;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => a.userId.localeCompare(b.userId) || (a.userAgent ?? "").localeCompare(b.userAgent ?? ""));
  }
}
