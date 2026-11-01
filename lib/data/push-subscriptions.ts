import { chunk } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Members per `.in(...)` lookup, so the request URL stays under the length limit. */
const MEMBER_ID_CHUNK = 200;

/** A browser a member turned Browser notifications on for. Holds push credentials: service role only. */
export type PushSubscriptionRow = {
  id: string;
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  lastSentAt: string | null;
  /** Paused while the member is signed out; resumed at their next sign-in. */
  pausedAt: string | null;
  /** The member turned it off (or removed the device): never resumed. */
  disabledAt: string | null;
  /** Soft delete: turned off, or the push service said the subscription is gone. */
  deletedAt: string | null;
};

/** What a send needs from a live subscription. */
export type LiveSubscription = Pick<PushSubscriptionRow, "id" | "endpoint" | "p256dh" | "auth">;

/** What the settings page shows of one of a member's devices. */
export type PushDevice = Pick<PushSubscriptionRow, "id" | "endpoint" | "userAgent" | "createdAt" | "lastSentAt" | "pausedAt">;

export type NewPushSubscription = Pick<PushSubscriptionRow, "memberId" | "endpoint" | "p256dh" | "auth" | "userAgent">;

/**
 * Web Push subscriptions. A subscription is *live* when it is not deleted, paused or disabled. Every
 * method throws on a database error; the callers decide what that means.
 */
export interface PushSubscriptionRepository {
  /** Which of these members have at least one live subscription. */
  membersWithLive(memberIds: string[]): Promise<Set<string>>;
  /** A member's live subscriptions, with the credentials to send to them. */
  live(memberId: string): Promise<LiveSubscription[]>;
  /** A member's devices that aren't deleted (paused ones included), newest first. */
  devices(memberId: string): Promise<PushDevice[]>;
  /** Saves this browser for the member. The same endpoint reuses its row and revives it (undeleted, unpaused, enabled), moving to this member. */
  save(subscription: NewPushSubscription): Promise<void>;
  /** Turns off the member's device with this endpoint (soft delete, and never resumed). */
  removeByEndpoint(memberId: string, endpoint: string, at: string): Promise<void>;
  /** Turns off the member's device with this id. */
  removeById(memberId: string, id: string, at: string): Promise<void>;
  /** Pauses the member's device with this endpoint, unless the member turned it off. */
  pause(memberId: string, endpoint: string, at: string): Promise<void>;
  /** Resumes the member's paused device onto a new endpoint and keys, unless they turned it off; false if there was none to resume. */
  resume(memberId: string, previousEndpoint: string, next: Pick<NewPushSubscription, "endpoint" | "p256dh" | "auth">): Promise<boolean>;
  /** Stamps these subscriptions as just sent to. */
  markSent(ids: string[], at: string): Promise<void>;
  /** Soft-deletes these subscriptions: the push service said they are gone. */
  markGone(ids: string[], at: string): Promise<void>;
}

const LIVE = <Q extends { is(column: string, value: null): Q }>(q: Q) => q.is("deleted_at", null).is("paused_at", null).is("disabled_at", null);

export class SupabasePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: Db) {}

  async membersWithLive(memberIds: string[]): Promise<Set<string>> {
    const reachable = new Set<string>();
    for (const ids of chunk(memberIds, MEMBER_ID_CHUNK)) {
      const { data, error } = await LIVE(this.db.from("push_subscriptions").select("member_id")).in("member_id", ids);
      if (error) throw new Error(`push_subscriptions lookup failed: ${error.message}`);
      for (const row of (data ?? []) as { member_id: string }[]) reachable.add(row.member_id);
    }
    return reachable;
  }

  async live(memberId: string): Promise<LiveSubscription[]> {
    const { data, error } = await LIVE(this.db.from("push_subscriptions").select("id, endpoint, p256dh, auth")).eq("member_id", memberId);
    if (error) throw new Error(`push_subscriptions lookup failed: ${error.message}`);
    return (data ?? []) as LiveSubscription[];
  }

  async devices(memberId: string): Promise<PushDevice[]> {
    const { data, error } = await this.db
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at, last_sent_at, paused_at")
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(`push_subscriptions lookup failed: ${error.message}`);
    return (data ?? []).map((r) => ({ id: r.id, endpoint: r.endpoint, userAgent: r.user_agent, createdAt: r.created_at, lastSentAt: r.last_sent_at, pausedAt: r.paused_at ?? null }));
  }

  async save(s: NewPushSubscription): Promise<void> {
    const { error } = await this.db
      .from("push_subscriptions")
      .upsert(
        { member_id: s.memberId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, user_agent: s.userAgent, deleted_at: null, paused_at: null, disabled_at: null },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
  }

  async removeByEndpoint(memberId: string, endpoint: string, at: string): Promise<void> {
    const { error } = await this.db.from("push_subscriptions").update({ deleted_at: at, disabled_at: at }).eq("member_id", memberId).eq("endpoint", endpoint);
    if (error) throw new Error(error.message);
  }

  async removeById(memberId: string, id: string, at: string): Promise<void> {
    const { error } = await this.db.from("push_subscriptions").update({ deleted_at: at, disabled_at: at }).eq("member_id", memberId).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async pause(memberId: string, endpoint: string, at: string): Promise<void> {
    const { error } = await this.db.from("push_subscriptions").update({ paused_at: at }).eq("member_id", memberId).eq("endpoint", endpoint).is("disabled_at", null);
    if (error) throw new Error(error.message);
  }

  async resume(memberId: string, previousEndpoint: string, next: Pick<NewPushSubscription, "endpoint" | "p256dh" | "auth">): Promise<boolean> {
    const { data, error } = await this.db
      .from("push_subscriptions")
      .update({ endpoint: next.endpoint, p256dh: next.p256dh, auth: next.auth, paused_at: null, deleted_at: null })
      .eq("member_id", memberId)
      .eq("endpoint", previousEndpoint)
      .is("disabled_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }

  async markSent(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.db.from("push_subscriptions").update({ last_sent_at: at }).in("id", ids);
    if (error) throw new Error(error.message);
  }

  async markGone(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.db.from("push_subscriptions").update({ deleted_at: at }).in("id", ids);
    if (error) throw new Error(error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private isLive(s: PushSubscriptionRow) {
    return !s.deletedAt && !s.pausedAt && !s.disabledAt;
  }

  async membersWithLive(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return new Set(this.data.pushSubscriptions.filter((s) => wanted.has(s.memberId) && this.isLive(s)).map((s) => s.memberId));
  }

  async live(memberId: string) {
    return this.data.pushSubscriptions.filter((s) => s.memberId === memberId && this.isLive(s)).map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth }));
  }

  async devices(memberId: string) {
    return this.data.pushSubscriptions
      .filter((s) => s.memberId === memberId && !s.deletedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
      .map(({ id, endpoint, userAgent, createdAt, lastSentAt, pausedAt }) => ({ id, endpoint, userAgent, createdAt, lastSentAt, pausedAt }));
  }

  async save(s: NewPushSubscription) {
    const existing = this.data.pushSubscriptions.find((x) => x.endpoint === s.endpoint);
    if (existing) {
      Object.assign(existing, { memberId: s.memberId, p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent, deletedAt: null, pausedAt: null, disabledAt: null });
      return;
    }
    // Strictly after every earlier one, like the database's clock, so "newest first" never ties.
    const latest = Math.max(0, ...this.data.pushSubscriptions.map((x) => Date.parse(x.createdAt)));
    this.data.pushSubscriptions.push({
      ...s,
      id: `psub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      createdAt: new Date(Math.max(Date.now(), latest + 1)).toISOString(),
      lastSentAt: null,
      pausedAt: null,
      disabledAt: null,
      deletedAt: null,
    });
  }

  async removeByEndpoint(memberId: string, endpoint: string, at: string) {
    for (const s of this.data.pushSubscriptions) if (s.memberId === memberId && s.endpoint === endpoint) Object.assign(s, { deletedAt: at, disabledAt: at });
  }

  async removeById(memberId: string, id: string, at: string) {
    for (const s of this.data.pushSubscriptions) if (s.memberId === memberId && s.id === id) Object.assign(s, { deletedAt: at, disabledAt: at });
  }

  async pause(memberId: string, endpoint: string, at: string) {
    for (const s of this.data.pushSubscriptions) if (s.memberId === memberId && s.endpoint === endpoint && !s.disabledAt) s.pausedAt = at;
  }

  async resume(memberId: string, previousEndpoint: string, next: Pick<NewPushSubscription, "endpoint" | "p256dh" | "auth">) {
    const found = this.data.pushSubscriptions.filter((s) => s.memberId === memberId && s.endpoint === previousEndpoint && !s.disabledAt);
    for (const s of found) Object.assign(s, { endpoint: next.endpoint, p256dh: next.p256dh, auth: next.auth, pausedAt: null, deletedAt: null });
    return found.length > 0;
  }

  async markSent(ids: string[], at: string) {
    const wanted = new Set(ids);
    for (const s of this.data.pushSubscriptions) if (wanted.has(s.id)) s.lastSentAt = at;
  }

  async markGone(ids: string[], at: string) {
    const wanted = new Set(ids);
    for (const s of this.data.pushSubscriptions) if (wanted.has(s.id)) s.deletedAt = at;
  }
}
