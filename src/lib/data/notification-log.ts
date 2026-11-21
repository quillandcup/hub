import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

const RECIPIENT_CHUNK = 200;

/** Who a send went to: a member, or a shared place such as a Slack channel (`slack:<channel id>`). */
export type LogRecipient = { memberId: string } | { place: string };

/** The one string that tells recipients apart: the member id, or the place. */
export const recipientOf = (to: LogRecipient): string => ("memberId" in to ? to.memberId : to.place);

/** A send the app made on its own initiative. One row per (recipient, kind, dedup key). */
export type NotificationLogRow = { id: string; kind: string; memberId: string | null; place: string | null; recipient: string; dedupKey: string; sentAt: string };

/**
 * The one log of what the app sent, for every kind (service role only): the claim that stops two runs or a
 * retry sending the same thing twice. The dedup key is the kind's own idea of "the same thing" (a changelog
 * entry's slug, a prickle id). A claim is taken before the send and given back when nothing was delivered.
 * Reads and `release` throw on a database error; `claim` answers false when someone already claimed it.
 */
export interface NotificationLogRepository {
  /** The dedup keys already sent of this kind, by recipient (`recipientOf`). Recipients with none are absent. */
  sentKeys(kind: string, to: LogRecipient[]): Promise<Map<string, Set<string>>>;
  /** Claims one send; false when it was already claimed (by an earlier run or a concurrent one). */
  claim(to: LogRecipient, kind: string, dedupKey: string, now: Date): Promise<boolean>;
  /** Gives the claim back, so a send that reached nobody can be tried again. */
  release(to: LogRecipient, kind: string, dedupKey: string): Promise<void>;
}

export class SupabaseNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly db: Db) {}

  async sentKeys(kind: string, to: LogRecipient[]): Promise<Map<string, Set<string>>> {
    const sent = new Map<string, Set<string>>();
    for (const recipients of chunk([...new Set(to.map(recipientOf))], RECIPIENT_CHUNK)) {
      const rows = await fetchAllRows<{ recipient: string | null; dedup_key: string }>((from, upTo) =>
        this.db.from("notification_log").select("recipient, dedup_key").eq("kind", kind).in("recipient", recipients).order("id").range(from, upTo),
      );
      for (const row of rows) {
        if (!row.recipient) continue;
        sent.set(row.recipient, (sent.get(row.recipient) ?? new Set()).add(row.dedup_key));
      }
    }
    return sent;
  }

  async claim(to: LogRecipient, kind: string, dedupKey: string, now: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from("notification_log")
      .insert({ kind, dedup_key: dedupKey, sent_at: now.toISOString(), ...("memberId" in to ? { member_id: to.memberId } : { place: to.place }) })
      .select("id");
    if (error) {
      // 23505: already claimed. Anything else is worth a log line; the caller treats both as "don't send".
      if (error.code !== "23505") console.error(`Claiming ${kind} "${dedupKey}" for ${recipientOf(to)} failed:`, error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  }

  async release(to: LogRecipient, kind: string, dedupKey: string): Promise<void> {
    const { error } = await this.db.from("notification_log").delete().eq("recipient", recipientOf(to)).eq("kind", kind).eq("dedup_key", dedupKey);
    if (error) throw new Error(`Releasing ${kind} claim failed: ${error.message}`);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async sentKeys(kind: string, to: LogRecipient[]) {
    const wanted = new Set(to.map(recipientOf));
    const sent = new Map<string, Set<string>>();
    for (const row of this.data.notificationLog) {
      if (row.kind !== kind || !wanted.has(row.recipient)) continue;
      sent.set(row.recipient, (sent.get(row.recipient) ?? new Set()).add(row.dedupKey));
    }
    return sent;
  }

  async claim(to: LogRecipient, kind: string, dedupKey: string, now: Date) {
    const recipient = recipientOf(to);
    if (this.data.notificationLog.some((r) => r.recipient === recipient && r.kind === kind && r.dedupKey === dedupKey)) return false;
    this.data.notificationLog.push({
      id: `nlog_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      kind,
      memberId: "memberId" in to ? to.memberId : null,
      place: "place" in to ? to.place : null,
      recipient,
      dedupKey,
      sentAt: now.toISOString(),
    });
    return true;
  }

  async release(to: LogRecipient, kind: string, dedupKey: string) {
    const recipient = recipientOf(to);
    this.data.notificationLog = this.data.notificationLog.filter((r) => !(r.recipient === recipient && r.kind === kind && r.dedupKey === dedupKey));
  }
}
