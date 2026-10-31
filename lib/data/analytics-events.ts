import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { must } from "./query";

/** One event to store (`analytics_events`); what may go in it is decided by the tracking plan (`lib/analytics/events.ts`). */
export type NewAnalyticsEvent = Insert<"analytics_events">;

export type AnalyticsEventRow = Row<"analytics_events">;

/**
 * The raw usage events (`analytics_events`). Features never write here: `lib/analytics/` validates an
 * event against the tracking plan and hands the rows to this repository, so nothing undeclared is
 * stored. Reports read through SQL functions, not this table.
 *
 * Methods throw `new Error(<database message>)` on a database error. The analytics module decides
 * that recording an event must never fail a request, and catches.
 */
export interface AnalyticsEventRepository {
  /** Stores these events. Each (user, message id) is unique, so a repeated message id fails. */
  record(events: NewAnalyticsEvent[]): Promise<void>;
  /** Stores these events, skipping any whose (user, message id) is already stored (a browser retrying a batch). */
  recordIgnoringDuplicates(events: NewAnalyticsEvent[]): Promise<void>;
  /**
   * Deletes what the user did (every source except "system": the record that a notification was sent
   * to them is the app's own and stays), and returns how many rows went. Needs the service role,
   * since members cannot delete their own usage events.
   */
  deleteUsageEvents(userId: string): Promise<number>;
}

export class SupabaseAnalyticsEventRepository implements AnalyticsEventRepository {
  constructor(private readonly db: Db) {}

  async record(events: NewAnalyticsEvent[]) {
    must(await this.db.from("analytics_events").insert(events));
  }

  async recordIgnoringDuplicates(events: NewAnalyticsEvent[]) {
    must(await this.db.from("analytics_events").upsert(events, { onConflict: "user_id,message_id", ignoreDuplicates: true }));
  }

  async deleteUsageEvents(userId: string) {
    const result = await this.db.from("analytics_events").delete({ count: "exact" }).eq("user_id", userId).neq("source", "system");
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  }
}

export class InMemoryAnalyticsEventRepository implements AnalyticsEventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private add(event: NewAnalyticsEvent) {
    const nextId = this.data.analyticsEvents.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    this.data.analyticsEvents.push({
      id: nextId,
      context: {},
      properties: {},
      received_at: new Date().toISOString(),
      session_id: null,
      source: "client",
      sudo: false,
      ...event,
    });
  }

  private has(event: NewAnalyticsEvent) {
    return this.data.analyticsEvents.some((e) => e.user_id === event.user_id && e.message_id === event.message_id);
  }

  async record(events: NewAnalyticsEvent[]) {
    for (const event of events) {
      if (this.has(event)) throw new Error('duplicate key value violates unique constraint "analytics_events_user_id_message_id_key"');
    }
    for (const event of events) this.add(event);
  }

  async recordIgnoringDuplicates(events: NewAnalyticsEvent[]) {
    for (const event of events) if (!this.has(event)) this.add(event);
  }

  async deleteUsageEvents(userId: string) {
    const before = this.data.analyticsEvents.length;
    this.data.analyticsEvents = this.data.analyticsEvents.filter((e) => !(e.user_id === userId && e.source !== "system"));
    return before - this.data.analyticsEvents.length;
  }
}
