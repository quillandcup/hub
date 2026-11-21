import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

const MEMBER_ID_CHUNK = 200;

/** A reminder the app sent a member on its own initiative. At most one per member, kind and day. */
export type ReminderLogRow = { id: string; memberId: string; kind: string; sentAt: string; /** The calendar day (YYYY-MM-DD, UTC) it counts for. */ sentOn: string };

/**
 * The log of reminders sent (service role only): backoff, and the claim that stops two runs sending
 * the same reminder twice. Reads and writes throw on a database error, except `claim`, whose false
 * means someone else already claimed it.
 */
export interface ReminderLogRepository {
  /** When each reminder went out, by `${memberId}:${kind}`, across these members. */
  sentTimes(memberIds: string[]): Promise<Map<string, Date[]>>;
  /** Claims today's reminder of this kind for the member; false when another run already did. */
  claim(memberId: string, kind: string, now: Date): Promise<boolean>;
  /** Gives up a claim made today, so a reminder that reached nobody can be tried again. */
  release(memberId: string, kind: string, now: Date): Promise<void>;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

export class SupabaseReminderLogRepository implements ReminderLogRepository {
  constructor(private readonly db: Db) {}

  async sentTimes(memberIds: string[]): Promise<Map<string, Date[]>> {
    const log = new Map<string, Date[]>();
    for (const ids of chunk(memberIds, MEMBER_ID_CHUNK)) {
      const rows = await fetchAllRows<{ member_id: string; kind: string; sent_at: string }>(
        (from, to) =>
          this.db.from("member_reminder_log").select("member_id, kind, sent_at").in("member_id", ids).order("id").range(from, to),
      );
      for (const row of rows) {
        const key = `${row.member_id}:${row.kind}`;
        log.set(key, [...(log.get(key) ?? []), new Date(row.sent_at)]);
      }
    }
    return log;
  }

  async claim(memberId: string, kind: string, now: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from("member_reminder_log")
      .insert({ member_id: memberId, kind, sent_at: now.toISOString(), sent_on: dayOf(now) })
      .select("id");
    if (error) {
      if (error.code !== "23505") console.error(`Claiming the ${kind} reminder for member=${memberId} failed:`, error);
      return false;
    }
    return (data?.length ?? 0) > 0;
  }

  async release(memberId: string, kind: string, now: Date): Promise<void> {
    const { error } = await this.db.from("member_reminder_log").delete().eq("member_id", memberId).eq("kind", kind).eq("sent_on", dayOf(now));
    if (error) throw new Error(`Releasing ${kind} notification claim failed: ${error.message}`);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryReminderLogRepository implements ReminderLogRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async sentTimes(memberIds: string[]) {
    const wanted = new Set(memberIds);
    const log = new Map<string, Date[]>();
    for (const row of this.data.reminderLog) {
      if (!wanted.has(row.memberId)) continue;
      const key = `${row.memberId}:${row.kind}`;
      log.set(key, [...(log.get(key) ?? []), new Date(row.sentAt)]);
    }
    return log;
  }

  async claim(memberId: string, kind: string, now: Date) {
    const day = dayOf(now);
    if (this.data.reminderLog.some((r) => r.memberId === memberId && r.kind === kind && r.sentOn === day)) return false;
    this.data.reminderLog.push({ id: `rmd_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, memberId, kind, sentAt: now.toISOString(), sentOn: day });
    return true;
  }

  async release(memberId: string, kind: string, now: Date) {
    const day = dayOf(now);
    this.data.reminderLog = this.data.reminderLog.filter((r) => !(r.memberId === memberId && r.kind === kind && r.sentOn === day));
  }
}
