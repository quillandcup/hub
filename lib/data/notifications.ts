import { chunk } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Members per `.in(...)` lookup, so the request URL stays under the length limit. */
const MEMBER_ID_CHUNK = 200;

/** One stored override: this kind on this channel is on or off for the member. */
export type NotificationPreference = { memberId: string; kind: string; channel: string; enabled: boolean };

/** A notification the in-app channel sent a member, kept for good. */
export type InAppNotificationRow = {
  id: string;
  memberId: string;
  kind: string;
  /** What it is about (a prickle id for a check-in); lets the feature resolve it once dealt with. */
  ref: string | null;
  text: string;
  url: string | null;
  /** While it is still time-sensitive (ISO): shown as a banner too. */
  bannerUntil: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NewInAppNotification = Pick<InAppNotificationRow, "memberId" | "kind" | "ref" | "text" | "url" | "bannerUntil">;

/** Which of a member's notifications, in what order, for the inbox table. */
export type InAppPageQuery = {
  unreadOnly: boolean;
  /** Only this kind (null = every kind). */
  kind: string | null;
  sortBy: "created_at" | "kind";
  ascending: boolean;
  offset: number;
  limit: number;
};

/**
 * Member notification settings (the per-kind, per-channel overrides of the defaults) and the in-app
 * channel's inbox. Reads throw on a database error; callers that treat a failure as "nothing there"
 * (the bell) catch it, and ones that must not act on a failed lookup (opt-outs) let it propagate.
 */
export interface NotificationRepository {
  /** All of one member's stored overrides. */
  preferencesOf(memberId: string): Promise<NotificationPreference[]>;
  /** The overrides for one kind across these members, grouped by member (members with none are absent). */
  preferencesForKind(kind: string, memberIds: string[]): Promise<Map<string, NotificationPreference[]>>;
  /** Stores the member's choice for a kind on a channel, replacing any earlier one. */
  setPreference(memberId: string, kind: string, channel: string, enabled: boolean): Promise<void>;

  /** Adds an unread notification. */
  addInApp(notification: NewInAppNotification): Promise<void>;
  /** The member's newest `limit` notifications, newest first. */
  inAppLatest(memberId: string, limit: number): Promise<InAppNotificationRow[]>;
  /** The member's unread notifications, newest first, at most `limit`. */
  inAppUnread(memberId: string, limit: number): Promise<InAppNotificationRow[]>;
  /** How many the member has, optionally only unread and/or of one kind. */
  inAppCount(memberId: string, options?: { unreadOnly?: boolean; kind?: string | null }): Promise<number>;
  /** One page of the member's notifications for the inbox table (ties broken newest first). */
  inAppPage(memberId: string, query: InAppPageQuery): Promise<InAppNotificationRow[]>;
  /** One of the member's notifications, or null if it isn't theirs or doesn't exist. */
  inAppById(memberId: string, id: string): Promise<InAppNotificationRow | null>;
  /** Marks these of the member's notifications read. */
  markInAppRead(memberId: string, ids: string[]): Promise<void>;
  /** Puts these of the member's notifications back to unread. */
  markInAppUnread(memberId: string, ids: string[]): Promise<void>;
  /** Marks every one of the member's notifications read. */
  markAllInAppRead(memberId: string): Promise<void>;
  /** Marks the member's unread notifications of this kind about this ref read. */
  resolveInApp(memberId: string, kind: string, ref: string): Promise<void>;
}

const IN_APP_COLUMNS = "id, member_id, kind, ref, text, url, banner_until, read_at, created_at";
type InAppDbRow = {
  id: string;
  member_id: string;
  kind: string;
  ref: string | null;
  text: string;
  url: string | null;
  banner_until: string | null;
  read_at: string | null;
  created_at: string;
};
const toInApp = (row: InAppDbRow): InAppNotificationRow => ({
  id: row.id,
  memberId: row.member_id,
  kind: row.kind,
  ref: row.ref,
  text: row.text,
  url: row.url,
  bannerUntil: row.banner_until,
  readAt: row.read_at,
  createdAt: row.created_at,
});

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async preferencesOf(memberId: string): Promise<NotificationPreference[]> {
    const { data, error } = await this.db.from("notification_preferences").select("member_id, kind, channel, enabled").eq("member_id", memberId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ memberId: r.member_id, kind: r.kind, channel: r.channel, enabled: r.enabled }));
  }

  async preferencesForKind(kind: string, memberIds: string[]): Promise<Map<string, NotificationPreference[]>> {
    const byMember = new Map<string, NotificationPreference[]>();
    for (const ids of chunk(memberIds, MEMBER_ID_CHUNK)) {
      const { data, error } = await this.db.from("notification_preferences").select("member_id, kind, channel, enabled").eq("kind", kind).in("member_id", ids);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const rows = byMember.get(r.member_id) ?? [];
        rows.push({ memberId: r.member_id, kind: r.kind, channel: r.channel, enabled: r.enabled });
        byMember.set(r.member_id, rows);
      }
    }
    return byMember;
  }

  async setPreference(memberId: string, kind: string, channel: string, enabled: boolean): Promise<void> {
    const { error } = await this.db
      .from("notification_preferences")
      .upsert({ member_id: memberId, kind, channel, enabled }, { onConflict: "member_id,kind,channel" });
    if (error) throw new Error(error.message);
  }

  async addInApp(n: NewInAppNotification): Promise<void> {
    const { error } = await this.db
      .from("in_app_notifications")
      .insert({ member_id: n.memberId, kind: n.kind, ref: n.ref, text: n.text, url: n.url, banner_until: n.bannerUntil });
    if (error) throw new Error(error.message);
  }

  async inAppLatest(memberId: string, limit: number): Promise<InAppNotificationRow[]> {
    const { data, error } = await this.db
      .from("in_app_notifications")
      .select(IN_APP_COLUMNS)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toInApp);
  }

  async inAppUnread(memberId: string, limit: number): Promise<InAppNotificationRow[]> {
    const { data, error } = await this.db
      .from("in_app_notifications")
      .select(IN_APP_COLUMNS)
      .eq("member_id", memberId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toInApp);
  }

  async inAppCount(memberId: string, { unreadOnly = false, kind = null }: { unreadOnly?: boolean; kind?: string | null } = {}): Promise<number> {
    let query = this.db.from("in_app_notifications").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    if (kind) query = query.eq("kind", kind);
    if (unreadOnly) query = query.is("read_at", null);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async inAppPage(memberId: string, { unreadOnly, kind, sortBy, ascending, offset, limit }: InAppPageQuery): Promise<InAppNotificationRow[]> {
    let query = this.db.from("in_app_notifications").select(IN_APP_COLUMNS).eq("member_id", memberId);
    if (kind) query = query.eq("kind", kind);
    if (unreadOnly) query = query.is("read_at", null);
    query = query.order(sortBy, { ascending });
    if (sortBy !== "created_at") query = query.order("created_at", { ascending: false });
    const { data, error } = await query.order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toInApp);
  }

  async inAppById(memberId: string, id: string): Promise<InAppNotificationRow | null> {
    const { data, error } = await this.db.from("in_app_notifications").select(IN_APP_COLUMNS).eq("id", id).eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toInApp(data) : null;
  }

  async markInAppRead(memberId: string, ids: string[]): Promise<void> {
    const { error } = await this.db
      .from("in_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .in("id", ids)
      .is("read_at", null);
    if (error) throw new Error(error.message);
  }

  async markInAppUnread(memberId: string, ids: string[]): Promise<void> {
    const { error } = await this.db
      .from("in_app_notifications")
      .update({ read_at: null })
      .eq("member_id", memberId)
      .in("id", ids)
      .not("read_at", "is", null);
    if (error) throw new Error(error.message);
  }

  async markAllInAppRead(memberId: string): Promise<void> {
    const { error } = await this.db
      .from("in_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
  }

  async resolveInApp(memberId: string, kind: string, ref: string): Promise<void> {
    const { error } = await this.db
      .from("in_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .eq("kind", kind)
      .eq("ref", ref)
      .is("read_at", null);
    if (error) throw new Error(error.message);
  }
}

const newestFirst = (a: InAppNotificationRow, b: InAppNotificationRow) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryNotificationRepository implements NotificationRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private mine(memberId: string) {
    return this.data.inAppNotifications.filter((n) => n.memberId === memberId);
  }

  async preferencesOf(memberId: string) {
    return this.data.notificationPreferences.filter((p) => p.memberId === memberId).map((p) => ({ ...p }));
  }

  async preferencesForKind(kind: string, memberIds: string[]) {
    const wanted = new Set(memberIds);
    const byMember = new Map<string, NotificationPreference[]>();
    for (const p of this.data.notificationPreferences) {
      if (p.kind !== kind || !wanted.has(p.memberId)) continue;
      byMember.set(p.memberId, [...(byMember.get(p.memberId) ?? []), { ...p }]);
    }
    return byMember;
  }

  async setPreference(memberId: string, kind: string, channel: string, enabled: boolean) {
    const existing = this.data.notificationPreferences.find((p) => p.memberId === memberId && p.kind === kind && p.channel === channel);
    if (existing) existing.enabled = enabled;
    else this.data.notificationPreferences.push({ memberId, kind, channel, enabled });
  }

  async addInApp(n: NewInAppNotification) {
    const id = `ntf_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.data.inAppNotifications.push({ ...n, id, readAt: null, createdAt: new Date().toISOString() });
  }

  async inAppLatest(memberId: string, limit: number) {
    return this.mine(memberId).sort(newestFirst).slice(0, limit).map((n) => ({ ...n }));
  }

  async inAppUnread(memberId: string, limit: number) {
    return this.mine(memberId).filter((n) => n.readAt === null).sort(newestFirst).slice(0, limit).map((n) => ({ ...n }));
  }

  async inAppCount(memberId: string, { unreadOnly = false, kind = null }: { unreadOnly?: boolean; kind?: string | null } = {}) {
    return this.mine(memberId).filter((n) => (!kind || n.kind === kind) && (!unreadOnly || n.readAt === null)).length;
  }

  async inAppPage(memberId: string, { unreadOnly, kind, sortBy, ascending, offset, limit }: InAppPageQuery) {
    const direction = ascending ? 1 : -1;
    return this.mine(memberId)
      .filter((n) => (!kind || n.kind === kind) && (!unreadOnly || n.readAt === null))
      .sort((a, b) => {
        const primary = sortBy === "kind" ? a.kind.localeCompare(b.kind) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        return primary * direction || newestFirst(a, b);
      })
      .slice(offset, offset + limit)
      .map((n) => ({ ...n }));
  }

  async inAppById(memberId: string, id: string) {
    const found = this.mine(memberId).find((n) => n.id === id);
    return found ? { ...found } : null;
  }

  async markInAppRead(memberId: string, ids: string[]) {
    const wanted = new Set(ids);
    for (const n of this.mine(memberId)) if (wanted.has(n.id) && n.readAt === null) n.readAt = new Date().toISOString();
  }

  async markInAppUnread(memberId: string, ids: string[]) {
    const wanted = new Set(ids);
    for (const n of this.mine(memberId)) if (wanted.has(n.id)) n.readAt = null;
  }

  async markAllInAppRead(memberId: string) {
    for (const n of this.mine(memberId)) if (n.readAt === null) n.readAt = new Date().toISOString();
  }

  async resolveInApp(memberId: string, kind: string, ref: string) {
    for (const n of this.mine(memberId)) if (n.kind === kind && n.ref === ref && n.readAt === null) n.readAt = new Date().toISOString();
  }
}
