import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import { eventDetails } from "./events";
import type { InMemoryDataset } from "./in-memory";

/** A kind of badge: an automatic one is computed in code, a manual one is awarded by an admin. */
export interface BadgeType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  has_levels: boolean;
  is_automatic: boolean;
  program_id: string | null;
  /** The events row a retreat badge commemorates (see badge_types.event_id), if linked. */
  event_id?: string | null;
  /** That event's slug, for linking to its member-facing /events/[slug] page. Only populated by `types()`. */
  event_slug?: string | null;
}

export interface BadgeLevel {
  id: string;
  badge_type_id: string;
  level: number;
  name: string;
  threshold: number | null;
}

/** A badge awarded to a member (by an admin, or from event attendance). */
export type MemberBadge = {
  id: string;
  memberId: string;
  badgeTypeId: string;
  occurredAt: string;
  note: string | null;
  /** The event whose attendance granted it; such awards are removed on the event page, not here. */
  eventId: string | null;
  awardedBy: string | null;
};

/** A member's award with the badge's name and icon and the event it came from, for the admin member page. */
export type MemberBadgeDetail = MemberBadge & {
  badgeTypeName: string | null;
  badgeTypeIcon: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
};

/** What a new badge type is made of; `isAutomatic` is true when it is linked to a program. */
export type NewBadgeType = {
  key: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  hasLevels: boolean;
  isAutomatic: boolean;
  eventId: string | null;
  programId: string | null;
};

export type BadgeTypePatch = Omit<NewBadgeType, "key" | "isAutomatic"> & { isAutomatic?: boolean };

/** The result of creating or changing a badge type: another badge type may already own the event. */
export type BadgeTypeResult = { ok: true; badgeType: BadgeType } | { ok: false; reason: "event_taken" | "not_found" };

export type LevelInput = { level: number; name: string; threshold: number | null };

/**
 * Badge types, their levels and the awards members hold. Reads and writes throw on a database error,
 * except where a result says why a write was refused.
 */
export interface BadgeRepository {
  /** Every badge type with its event's slug, by category then name. */
  types(): Promise<BadgeType[]>;
  typeById(id: string): Promise<BadgeType | null>;
  typeByKey(key: string): Promise<BadgeType | null>;
  /** The badge type linked to this event, if any. */
  typeForEvent(eventId: string): Promise<Pick<BadgeType, "id" | "name" | "icon"> | null>;
  /** The badge types an admin can award by hand (not automatic, not tied to an event), by name. */
  manualTypes(): Promise<Pick<BadgeType, "id" | "name" | "icon">[]>;
  /** Ids of the events some badge type is linked to, optionally leaving out one badge type. */
  linkedEventIds(options?: { exceptTypeId?: string }): Promise<Set<string>>;
  createType(input: NewBadgeType): Promise<BadgeTypeResult>;
  updateType(id: string, patch: BadgeTypePatch): Promise<BadgeTypeResult>;
  deleteType(id: string): Promise<void>;

  /** Every level of every badge type, lowest level first. */
  levels(): Promise<BadgeLevel[]>;
  levelsOf(badgeTypeId: string): Promise<BadgeLevel[]>;
  /** Replaces a badge type's levels with these. */
  replaceLevels(badgeTypeId: string, levels: LevelInput[]): Promise<void>;

  /** A member's awards, as (badge type, when, note). */
  awardsOf(memberId: string): Promise<Pick<MemberBadge, "badgeTypeId" | "occurredAt" | "note">[]>;
  /** Everyone's awards of one badge type, as (member, when, note). */
  awardsOfType(badgeTypeId: string): Promise<Pick<MemberBadge, "memberId" | "occurredAt" | "note">[]>;
  /** How many awards each badge type has (types with none are absent). */
  awardCounts(): Promise<Map<string, number>>;
  /** A member's awards, newest first, with the badge and event details. */
  awardsWithDetails(memberId: string): Promise<MemberBadgeDetail[]>;
  awardById(id: string): Promise<MemberBadge | null>;
  /** Awards a badge by hand; `awardedBy` is the admin's auth user id (null for the system). */
  award(input: { memberId: string; badgeTypeId: string; occurredAt?: string; note: string | null; awardedBy: string | null }): Promise<MemberBadge>;
  /** Removes an award. */
  revoke(id: string): Promise<void>;
}

type TypeRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  has_levels: boolean;
  is_automatic: boolean;
  program_id: string | null;
  event_id: string | null;
};
const TYPE_COLUMNS = "id, key, name, description, icon, category, has_levels, is_automatic, program_id, event_id";
const toType = (r: TypeRow): BadgeType => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  icon: r.icon,
  category: r.category,
  has_levels: r.has_levels,
  is_automatic: r.is_automatic,
  program_id: r.program_id,
  event_id: r.event_id,
});

type AwardRow = {
  id: string;
  member_id: string;
  badge_type_id: string;
  occurred_at: string;
  note: string | null;
  event_id: string | null;
  awarded_by: string | null;
};
const AWARD_COLUMNS = "id, member_id, badge_type_id, occurred_at, note, event_id, awarded_by";
const toAward = (r: AwardRow): MemberBadge => ({
  id: r.id,
  memberId: r.member_id,
  badgeTypeId: r.badge_type_id,
  occurredAt: r.occurred_at,
  note: r.note,
  eventId: r.event_id,
  awardedBy: r.awarded_by,
});

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

export class SupabaseBadgeRepository implements BadgeRepository {
  constructor(private readonly db: Db) {}

  async types(): Promise<BadgeType[]> {
    const { data, error } = await this.db.from("badge_types").select(`${TYPE_COLUMNS}, event:community_events(slug)`).order("category").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({ ...toType(row), event_slug: one(row.event)?.slug ?? null }));
  }

  async typeById(id: string): Promise<BadgeType | null> {
    const { data, error } = await this.db.from("badge_types").select(TYPE_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toType(data) : null;
  }

  async typeByKey(key: string): Promise<BadgeType | null> {
    const { data, error } = await this.db.from("badge_types").select(TYPE_COLUMNS).eq("key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toType(data) : null;
  }

  async typeForEvent(eventId: string) {
    const { data, error } = await this.db.from("badge_types").select("id, name, icon").eq("event_id", eventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async manualTypes() {
    const { data, error } = await this.db.from("badge_types").select("id, name, icon").eq("is_automatic", false).is("event_id", null).order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async linkedEventIds({ exceptTypeId }: { exceptTypeId?: string } = {}): Promise<Set<string>> {
    let query = this.db.from("badge_types").select("event_id").not("event_id", "is", null);
    if (exceptTypeId) query = query.neq("id", exceptTypeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((r) => r.event_id as string));
  }

  async createType(input: NewBadgeType): Promise<BadgeTypeResult> {
    const { data, error } = await this.db
      .from("badge_types")
      .insert({
        key: input.key,
        name: input.name,
        description: input.description,
        icon: input.icon,
        category: input.category,
        has_levels: input.hasLevels,
        is_automatic: input.isAutomatic,
        event_id: input.eventId,
        program_id: input.programId,
      })
      .select(TYPE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505" && error.message.includes("event_id")) return { ok: false, reason: "event_taken" };
      throw new Error(error.message);
    }
    return { ok: true, badgeType: toType(data) };
  }

  async updateType(id: string, patch: BadgeTypePatch): Promise<BadgeTypeResult> {
    const { data, error } = await this.db
      .from("badge_types")
      .update({
        name: patch.name,
        description: patch.description,
        icon: patch.icon,
        category: patch.category,
        has_levels: patch.hasLevels,
        event_id: patch.eventId,
        program_id: patch.programId,
        ...(patch.isAutomatic === undefined ? {} : { is_automatic: patch.isAutomatic }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(TYPE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23505" && error.message.includes("event_id")) return { ok: false, reason: "event_taken" };
      throw new Error(error.message);
    }
    return data ? { ok: true, badgeType: toType(data) } : { ok: false, reason: "not_found" };
  }

  async deleteType(id: string): Promise<void> {
    const { error } = await this.db.from("badge_types").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async levels(): Promise<BadgeLevel[]> {
    const { data, error } = await this.db.from("badge_levels").select("id, badge_type_id, level, name, threshold").order("level");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async levelsOf(badgeTypeId: string): Promise<BadgeLevel[]> {
    const { data, error } = await this.db.from("badge_levels").select("id, badge_type_id, level, name, threshold").eq("badge_type_id", badgeTypeId).order("level");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async replaceLevels(badgeTypeId: string, levels: LevelInput[]): Promise<void> {
    const { error: deleteError } = await this.db.from("badge_levels").delete().eq("badge_type_id", badgeTypeId);
    if (deleteError) throw new Error(deleteError.message);
    if (levels.length === 0) return;
    const { error } = await this.db
      .from("badge_levels")
      .insert(levels.map((l) => ({ badge_type_id: badgeTypeId, level: l.level, name: l.name, threshold: l.threshold })));
    if (error) throw new Error(error.message);
  }

  async awardsOf(memberId: string) {
    const rows = await fetchAllRows<{ badge_type_id: string; occurred_at: string; note: string | null }>(
      (from, to) =>
        this.db.from("member_badges").select("badge_type_id, occurred_at, note").eq("member_id", memberId).order("id").range(from, to),
    );
    return rows.map((r) => ({ badgeTypeId: r.badge_type_id, occurredAt: r.occurred_at, note: r.note }));
  }

  async awardsOfType(badgeTypeId: string) {
    const rows = await fetchAllRows<{ member_id: string; occurred_at: string; note: string | null }>(
      (from, to) =>
        this.db.from("member_badges").select("member_id, occurred_at, note").eq("badge_type_id", badgeTypeId).order("id").range(from, to),
    );
    return rows.map((r) => ({ memberId: r.member_id, occurredAt: r.occurred_at, note: r.note }));
  }

  async awardCounts(): Promise<Map<string, number>> {
    const rows = await fetchAllRows<{ badge_type_id: string }>(
      (from, to) =>
        this.db.from("member_badges").select("badge_type_id").order("id").range(from, to),
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.badge_type_id, (counts.get(r.badge_type_id) ?? 0) + 1);
    return counts;
  }

  async awardsWithDetails(memberId: string): Promise<MemberBadgeDetail[]> {
    const { data, error } = await this.db
      .from("member_badges")
      .select(`${AWARD_COLUMNS}, badge_types(name, icon), community_event_details(title, slug)`)
      .eq("member_id", memberId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const r = row;
      const type = one(r.badge_types);
      const event = one(r.community_event_details);
      return { ...toAward(r), badgeTypeName: type?.name ?? null, badgeTypeIcon: type?.icon ?? null, eventTitle: event?.title ?? null, eventSlug: event?.slug ?? null };
    });
  }

  async awardById(id: string): Promise<MemberBadge | null> {
    const { data, error } = await this.db.from("member_badges").select(AWARD_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toAward(data) : null;
  }

  async award({ memberId, badgeTypeId, occurredAt, note, awardedBy }: { memberId: string; badgeTypeId: string; occurredAt?: string; note: string | null; awardedBy: string | null }): Promise<MemberBadge> {
    const { data, error } = await this.db
      .from("member_badges")
      .insert({ member_id: memberId, badge_type_id: badgeTypeId, occurred_at: occurredAt || undefined, note, awarded_by: awardedBy })
      .select(AWARD_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Couldn't award the badge");
    return toAward(data);
  }

  async revoke(id: string): Promise<void> {
    const { error } = await this.db.from("member_badges").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryBadgeRepository implements BadgeRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private withEvent(t: BadgeType): BadgeType {
    return { ...t, event_slug: this.data.events.find((e) => e.id === t.event_id)?.slug ?? null };
  }

  async types() {
    return this.data.badgeTypes
      .map((t) => this.withEvent(t))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async typeById(id: string) {
    const t = this.data.badgeTypes.find((x) => x.id === id);
    return t ? { ...t } : null;
  }

  async typeByKey(key: string) {
    const t = this.data.badgeTypes.find((x) => x.key === key);
    return t ? { ...t } : null;
  }

  async typeForEvent(eventId: string) {
    const t = this.data.badgeTypes.find((x) => x.event_id === eventId);
    return t ? { id: t.id, name: t.name, icon: t.icon } : null;
  }

  async manualTypes() {
    return this.data.badgeTypes
      .filter((t) => !t.is_automatic && !t.event_id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
  }

  async linkedEventIds({ exceptTypeId }: { exceptTypeId?: string } = {}) {
    return new Set(this.data.badgeTypes.filter((t) => t.event_id && t.id !== exceptTypeId).map((t) => t.event_id as string));
  }

  async createType(input: NewBadgeType): Promise<BadgeTypeResult> {
    if (input.eventId && this.data.badgeTypes.some((t) => t.event_id === input.eventId)) return { ok: false, reason: "event_taken" };
    const badgeType: BadgeType = {
      id: newId("bdgt"),
      key: input.key,
      name: input.name,
      description: input.description,
      icon: input.icon,
      category: input.category,
      has_levels: input.hasLevels,
      is_automatic: input.isAutomatic,
      program_id: input.programId,
      event_id: input.eventId,
    };
    this.data.badgeTypes.push(badgeType);
    return { ok: true, badgeType: { ...badgeType } };
  }

  async updateType(id: string, patch: BadgeTypePatch): Promise<BadgeTypeResult> {
    const t = this.data.badgeTypes.find((x) => x.id === id);
    if (!t) return { ok: false, reason: "not_found" };
    if (patch.eventId && this.data.badgeTypes.some((x) => x.id !== id && x.event_id === patch.eventId)) return { ok: false, reason: "event_taken" };
    Object.assign(t, {
      name: patch.name,
      description: patch.description,
      icon: patch.icon,
      category: patch.category,
      has_levels: patch.hasLevels,
      event_id: patch.eventId,
      program_id: patch.programId,
      ...(patch.isAutomatic === undefined ? {} : { is_automatic: patch.isAutomatic }),
    });
    return { ok: true, badgeType: { ...t } };
  }

  async deleteType(id: string) {
    this.data.badgeTypes = this.data.badgeTypes.filter((t) => t.id !== id);
    this.data.badgeLevels = this.data.badgeLevels.filter((l) => l.badge_type_id !== id);
    this.data.memberBadges = this.data.memberBadges.filter((b) => b.badgeTypeId !== id);
  }

  async levels() {
    return [...this.data.badgeLevels].sort((a, b) => a.level - b.level).map((l) => ({ ...l }));
  }

  async levelsOf(badgeTypeId: string) {
    return (await this.levels()).filter((l) => l.badge_type_id === badgeTypeId);
  }

  async replaceLevels(badgeTypeId: string, levels: LevelInput[]) {
    this.data.badgeLevels = this.data.badgeLevels.filter((l) => l.badge_type_id !== badgeTypeId);
    for (const l of levels) this.data.badgeLevels.push({ id: newId("bdgl"), badge_type_id: badgeTypeId, level: l.level, name: l.name, threshold: l.threshold });
  }

  async awardsOf(memberId: string) {
    return this.data.memberBadges.filter((b) => b.memberId === memberId).map((b) => ({ badgeTypeId: b.badgeTypeId, occurredAt: b.occurredAt, note: b.note }));
  }

  async awardsOfType(badgeTypeId: string) {
    return this.data.memberBadges.filter((b) => b.badgeTypeId === badgeTypeId).map((b) => ({ memberId: b.memberId, occurredAt: b.occurredAt, note: b.note }));
  }

  async awardCounts() {
    const counts = new Map<string, number>();
    for (const b of this.data.memberBadges) counts.set(b.badgeTypeId, (counts.get(b.badgeTypeId) ?? 0) + 1);
    return counts;
  }

  async awardsWithDetails(memberId: string): Promise<MemberBadgeDetail[]> {
    return this.data.memberBadges
      .filter((b) => b.memberId === memberId)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.id < b.id ? 1 : -1))
      .map((b) => {
        const type = this.data.badgeTypes.find((t) => t.id === b.badgeTypeId);
        const event = eventDetails(this.data).find((e) => e.id === b.eventId);
        return { ...b, badgeTypeName: type?.name ?? null, badgeTypeIcon: type?.icon ?? null, eventTitle: event?.title ?? null, eventSlug: event?.slug ?? null };
      });
  }

  async awardById(id: string) {
    const b = this.data.memberBadges.find((x) => x.id === id);
    return b ? { ...b } : null;
  }

  async award({ memberId, badgeTypeId, occurredAt, note, awardedBy }: { memberId: string; badgeTypeId: string; occurredAt?: string; note: string | null; awardedBy: string | null }) {
    const badge: MemberBadge = { id: newId("mbdg"), memberId, badgeTypeId, occurredAt: (occurredAt || new Date().toISOString()).slice(0, 10), note, eventId: null, awardedBy };
    this.data.memberBadges.push(badge);
    return { ...badge };
  }

  async revoke(id: string) {
    this.data.memberBadges = this.data.memberBadges.filter((b) => b.id !== id);
  }
}
