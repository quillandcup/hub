import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText, inChunks, must } from "./query";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";

/** A stored email event (`bronze.resend_events`, service role only). */
export type ResendEventRow = Database["bronze"]["Tables"]["resend_events"]["Row"];
/** What the webhook and the nightly pull write; the database fills `id` and `received_at`. */
export type NewResendEvent = Database["bronze"]["Tables"]["resend_events"]["Insert"];
/** An event without the raw payload, which projections never need. */
export type ResendEvent = Omit<ResendEventRow, "raw_payload" | "received_at">;

const EMAIL_ID_CHUNK = 100;
const INSERT_CHUNK = 500;
const EVENT_COLUMNS = "id, event_id, event_type, email_id, occurred_at, recipients, from_address, subject, tags, link, bounce_type, detail";

/**
 * The email events Resend reports (sent, delivered, opened, clicked, bounced, ...), append-only
 * (`bronze.resend_events`; docs/EMAIL_TIMELINE.md). Service role only: the table holds recipients' addresses
 * and subjects and grants nothing to signed-in users. Methods throw `new Error(<database message>)` on a
 * database error.
 */
export interface ResendEventRepository {
  /** Stores events; one whose `event_id` is already stored is skipped, so a webhook retry or a second pull writes nothing new. */
  record(events: NewResendEvent[]): Promise<void>;
  /** The events of these emails, oldest first (ties by id). Chunked. */
  eventsForEmails(emailIds: string[]): Promise<ResendEvent[]>;
  /** The ids of the emails that had an event at or after this time (ISO), paginated past 1000, sorted. */
  emailIdsSince(sinceIso: string): Promise<string[]>;
}

export class SupabaseResendEventRepository implements ResendEventRepository {
  constructor(private readonly db: Db) {}

  async record(events: NewResendEvent[]) {
    // A bulk insert gives a column that some rows leave out the value null, not its default: fill the NOT NULL ones in.
    const rows = events.map((event) => ({ ...event, tags: event.tags ?? {}, recipients: event.recipients ?? [] }));
    for (const part of chunk(rows, INSERT_CHUNK)) {
      must(await this.db.schema("bronze").from("resend_events").upsert(part, { onConflict: "event_id", ignoreDuplicates: true }));
    }
  }

  async eventsForEmails(emailIds: string[]) {
    const rows = await inChunks(emailIds, EMAIL_ID_CHUNK, async (part) =>
      (must(await this.db.schema("bronze").from("resend_events").select(EVENT_COLUMNS).in("email_id", part)) ?? []) as ResendEvent[],
    );
    return rows.sort((a, b) => compareText(a.occurred_at, b.occurred_at) || compareText(a.id, b.id));
  }

  async emailIdsSince(sinceIso: string) {
    const rows = await fetchAllRows((from, to) =>
      this.db.schema("bronze").from("resend_events").select("id, email_id").gte("occurred_at", sinceIso).order("id").range(from, to),
    );
    return [...new Set(rows.map((r) => r.email_id))].sort(compareText);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryResendEventRepository implements ResendEventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async record(events: NewResendEvent[]) {
    for (const event of events) {
      if (this.data.resendEvents.some((r) => r.event_id === event.event_id)) continue;
      this.data.resendEvents.push({
        id: event.id ?? `rsev_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        from_address: null,
        subject: null,
        link: null,
        bounce_type: null,
        detail: null,
        recipients: [],
        tags: {},
        received_at: new Date().toISOString(),
        ...event,
      });
    }
  }

  async eventsForEmails(emailIds: string[]) {
    const wanted = new Set(emailIds);
    return this.data.resendEvents
      .filter((r) => wanted.has(r.email_id))
      .sort((a, b) => compareText(a.occurred_at, b.occurred_at) || compareText(a.id, b.id))
      .map((r) => ({
        id: r.id,
        event_id: r.event_id,
        event_type: r.event_type,
        email_id: r.email_id,
        occurred_at: r.occurred_at,
        recipients: [...r.recipients],
        from_address: r.from_address,
        subject: r.subject,
        tags: r.tags,
        link: r.link,
        bounce_type: r.bounce_type,
        detail: r.detail,
      }));
  }

  async emailIdsSince(sinceIso: string) {
    const ids = this.data.resendEvents.filter((r) => r.occurred_at >= sinceIso).map((r) => r.email_id);
    return [...new Set(ids)].sort(compareText);
  }
}
