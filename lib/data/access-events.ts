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
}

export class SupabaseAccessEventRepository implements AccessEventRepository {
  constructor(private readonly db: Db) {}

  async record(event: NewAccessEvent) {
    const { error } = await this.db.from("access_events").insert(event);
    if (error) throw new Error(error.message);
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
}
