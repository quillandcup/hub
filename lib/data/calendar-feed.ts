import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asPage, byKeyThenId, compareText } from "./query";

/**
 * What a member's personal calendar feed is built from: the secret token in its URL
 * (`calendar_feed_tokens`, one per member) and the prickles, weekly slots and events they added by
 * hand (`calendar_feed_items`). Local data: members own these rows, nothing reprocesses them.
 *
 * A feed token is a credential. Methods return it only to the member it belongs to (`tokenOf`), and no
 * error message or log line made here contains one.
 *
 * Every method throws on a database error (the database's message); lookups that find nothing return null.
 * Scans are paginated.
 */

/** The columns that say which thing an item is: a prickle (`prickle_id`), a weekly slot (type, weekday, time, zone) or an event. */
export type FeedItemRow = Pick<Row<"calendar_feed_items">, "kind" | "prickle_id" | "type_id" | "day_of_week" | "start_time_local" | "timezone" | "event_id">;

/** An item to add: the same columns, `kind` plus the ones that kind uses. */
export type NewFeedItem = Pick<Insert<"calendar_feed_items">, "kind" | "prickle_id" | "type_id" | "day_of_week" | "start_time_local" | "timezone" | "event_id">;

/** An item with what the My Prickles list shows about it: its type's name, its prickle or its event. */
export type ListedFeedItem = FeedItemRow &
  Pick<Row<"calendar_feed_items">, "id" | "created_at"> & {
    /** Name of the item's prickle type (a weekly slot's); null when it has none. */
    type_name: string | null;
    /** A prickle item's prickle; null for the other kinds, or when the prickle is gone. */
    prickle: { start_time: string; type_name: string | null } | null;
    /** An event item's event; null for the other kinds, or when the event is not visible. */
    event: { title: string; starts_at: string; ends_at: string } | null;
  };

/** Who a feed token belongs to, and whether a calendar app has fetched the feed yet. */
export type FeedTokenOwner = { memberId: string; firstFetchedAt: string | null };

/** A member who added a weekly slot to their calendar, and the time of day they chose. */
export type WeeklySlotMember = { memberId: string; startTimeLocal: string };

export interface CalendarFeedRepository {
  // --- tokens ---
  /** The member's feed token, or null when they have none yet. */
  tokenOf(memberId: string): Promise<string | null>;
  /** Stores `token` for the member unless they already have one (a concurrent request's wins). */
  createTokenIfMissing(memberId: string, token: string): Promise<void>;
  /** Replaces the member's token (or stores it), and forgets that a calendar app ever fetched the old one. */
  replaceToken(memberId: string, token: string): Promise<void>;
  /** Who a token belongs to, or null when it was never issued or has been replaced. */
  ownerOfToken(token: string): Promise<FeedTokenOwner | null>;
  /** Records the first fetch of a feed, once: a token that already has one is left alone. */
  recordFirstFetch(token: string, at: string): Promise<void>;
  /** Whether a calendar app has fetched the member's feed at least once. */
  hasBeenFetched(memberId: string): Promise<boolean>;

  // --- items ---
  /** The member's items as stored, ordered by id. Paginated. */
  itemsOf(memberId: string): Promise<FeedItemRow[]>;
  /** The member's items with their prickle type, prickle and event, oldest added first. Paginated. */
  listedItemsOf(memberId: string): Promise<ListedFeedItem[]>;
  /** How many items the member added. */
  countItems(memberId: string): Promise<number>;
  /** Adds an item for the member; "exists" when they already have that same prickle, slot or event. */
  addItem(memberId: string, createdBy: string | null, item: NewFeedItem): Promise<"added" | "exists">;
  /** Removes one of the member's items; nothing happens when there is no such item. */
  removeItem(memberId: string, itemId: string): Promise<void>;
  /** The members who added exactly this prickle ("just this one"). Paginated. */
  memberIdsWithPrickle(prickleId: string): Promise<string[]>;
  /** The members who added a weekly slot of this type, weekday and time zone (any time of day). Paginated. */
  weeklySlotMembers(slot: { typeId: string; dayOfWeek: number; timezone: string }): Promise<WeeklySlotMember[]>;
}

const LISTED_COLUMNS =
  "id, kind, prickle_id, type_id, day_of_week, start_time_local, timezone, event_id, created_at, prickle_types(name), prickles(start_time, prickle_types(name)), events(title, starts_at, ends_at)";
const ITEM_COLUMNS = "kind, prickle_id, type_id, day_of_week, start_time_local, timezone, event_id";

/** PostgREST returns a to-one embed as an object, though callers have also met it as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

type Embed<T> = T | T[] | null;
type ListedRaw = Pick<ListedFeedItem, "id" | "created_at"> &
  FeedItemRow & {
    prickle_types: Embed<{ name: string }>;
    prickles: Embed<{ start_time: string; prickle_types: Embed<{ name: string }> }>;
    events: Embed<{ title: string; starts_at: string; ends_at: string }>;
  };

/** Postgres returns a `time` as HH:MM:SS. */
const withSeconds = (time: string | null) => (time && time.length === 5 ? `${time}:00` : time);

export class SupabaseCalendarFeedRepository implements CalendarFeedRepository {
  constructor(private readonly db: Db) {}

  async tokenOf(memberId: string) {
    const { data, error } = await this.db.from("calendar_feed_tokens").select("token").eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.token ?? null;
  }

  async createTokenIfMissing(memberId: string, token: string) {
    const { error } = await this.db
      .from("calendar_feed_tokens")
      .upsert({ member_id: memberId, token }, { onConflict: "member_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async replaceToken(memberId: string, token: string) {
    const { error } = await this.db
      .from("calendar_feed_tokens")
      .upsert({ member_id: memberId, token, first_fetched_at: null, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
    if (error) throw new Error(error.message);
  }

  async ownerOfToken(token: string) {
    const { data, error } = await this.db.from("calendar_feed_tokens").select("member_id, first_fetched_at").eq("token", token).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { memberId: data.member_id, firstFetchedAt: data.first_fetched_at } : null;
  }

  async recordFirstFetch(token: string, at: string) {
    const { error } = await this.db.from("calendar_feed_tokens").update({ first_fetched_at: at }).eq("token", token).is("first_fetched_at", null);
    if (error) throw new Error(error.message);
  }

  async hasBeenFetched(memberId: string) {
    const { data, error } = await this.db.from("calendar_feed_tokens").select("first_fetched_at").eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return !!data?.first_fetched_at;
  }

  async itemsOf(memberId: string) {
    return fetchAllRows<FeedItemRow>((from, to) =>
      asPage<FeedItemRow>(this.db.from("calendar_feed_items").select(ITEM_COLUMNS).eq("member_id", memberId).order("id").range(from, to))
    );
  }

  async listedItemsOf(memberId: string) {
    const rows = await fetchAllRows<ListedRaw>((from, to) =>
      asPage<ListedRaw>(this.db.from("calendar_feed_items").select(LISTED_COLUMNS).eq("member_id", memberId).order("created_at").order("id").range(from, to))
    );
    return rows.map((row): ListedFeedItem => {
      const prickle = one(row.prickles);
      return {
        id: row.id,
        kind: row.kind,
        prickle_id: row.prickle_id,
        type_id: row.type_id,
        day_of_week: row.day_of_week,
        start_time_local: row.start_time_local,
        timezone: row.timezone,
        event_id: row.event_id,
        created_at: row.created_at,
        type_name: one(row.prickle_types)?.name ?? null,
        prickle: prickle ? { start_time: prickle.start_time, type_name: one(prickle.prickle_types)?.name ?? null } : null,
        event: one(row.events),
      };
    });
  }

  async countItems(memberId: string) {
    const { count, error } = await this.db.from("calendar_feed_items").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async addItem(memberId: string, createdBy: string | null, item: NewFeedItem) {
    const { error } = await this.db.from("calendar_feed_items").insert({ ...item, member_id: memberId, created_by: createdBy });
    // 23505: the member already has this prickle, slot or event (partial unique indexes).
    if (error && error.code !== "23505") throw new Error(error.message);
    return error ? "exists" : "added";
  }

  async removeItem(memberId: string, itemId: string) {
    const { error } = await this.db.from("calendar_feed_items").delete().eq("id", itemId).eq("member_id", memberId);
    if (error) throw new Error(error.message);
  }

  async memberIdsWithPrickle(prickleId: string) {
    const rows = await fetchAllRows<{ member_id: string }>((from, to) =>
      asPage<{ member_id: string }>(this.db.from("calendar_feed_items").select("member_id").eq("kind", "prickle").eq("prickle_id", prickleId).order("id").range(from, to))
    );
    return rows.map((r) => r.member_id);
  }

  async weeklySlotMembers(slot: { typeId: string; dayOfWeek: number; timezone: string }) {
    const rows = await fetchAllRows<{ member_id: string; start_time_local: string }>((from, to) =>
      asPage<{ member_id: string; start_time_local: string }>(
        this.db
          .from("calendar_feed_items")
          .select("member_id, start_time_local")
          .eq("kind", "slot")
          .eq("type_id", slot.typeId)
          .eq("day_of_week", slot.dayOfWeek)
          .eq("timezone", slot.timezone)
          .order("id")
          .range(from, to)
      )
    );
    return rows.map((r) => ({ memberId: r.member_id, startTimeLocal: r.start_time_local }));
  }
}

/** A feed token as the in-memory dataset keeps it. */
export type FeedTokenSeed = Pick<Row<"calendar_feed_tokens">, "member_id" | "token"> & Partial<Omit<Row<"calendar_feed_tokens">, "member_id" | "token">>;

/** A feed item as the in-memory dataset keeps it: the id and owner, and the columns its kind uses. */
export type FeedItemSeed = Pick<Row<"calendar_feed_items">, "id" | "member_id" | "kind"> & Partial<Omit<Row<"calendar_feed_items">, "id" | "member_id" | "kind">>;

export class InMemoryCalendarFeedRepository implements CalendarFeedRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private itemsFor(memberId: string) {
    return this.data.calendarFeedItems.filter((i) => i.member_id === memberId);
  }

  async tokenOf(memberId: string) {
    return this.data.calendarFeedTokens.find((t) => t.member_id === memberId)?.token ?? null;
  }

  async createTokenIfMissing(memberId: string, token: string) {
    if (this.data.calendarFeedTokens.some((t) => t.member_id === memberId)) return;
    const now = new Date().toISOString();
    this.data.calendarFeedTokens.push({ member_id: memberId, token, first_fetched_at: null, created_at: now, updated_at: now });
  }

  async replaceToken(memberId: string, token: string) {
    const now = new Date().toISOString();
    const existing = this.data.calendarFeedTokens.find((t) => t.member_id === memberId);
    if (existing) Object.assign(existing, { token, first_fetched_at: null, updated_at: now });
    else this.data.calendarFeedTokens.push({ member_id: memberId, token, first_fetched_at: null, created_at: now, updated_at: now });
  }

  async ownerOfToken(token: string) {
    const row = this.data.calendarFeedTokens.find((t) => t.token === token);
    return row ? { memberId: row.member_id, firstFetchedAt: row.first_fetched_at ?? null } : null;
  }

  async recordFirstFetch(token: string, at: string) {
    const row = this.data.calendarFeedTokens.find((t) => t.token === token);
    if (row && !row.first_fetched_at) row.first_fetched_at = at;
  }

  async hasBeenFetched(memberId: string) {
    return !!this.data.calendarFeedTokens.find((t) => t.member_id === memberId)?.first_fetched_at;
  }

  async itemsOf(memberId: string) {
    return this.itemsFor(memberId)
      .sort((a, b) => compareText(a.id, b.id))
      .map((i) => this.toRow(i));
  }

  private toRow(i: FeedItemSeed): FeedItemRow {
    return {
      kind: i.kind,
      prickle_id: i.prickle_id ?? null,
      type_id: i.type_id ?? null,
      day_of_week: i.day_of_week ?? null,
      start_time_local: withSeconds(i.start_time_local ?? null),
      timezone: i.timezone ?? null,
      event_id: i.event_id ?? null,
    };
  }

  async listedItemsOf(memberId: string) {
    const typeName = (id: string | null | undefined) => this.data.prickleTypes.find((t) => t.id === id)?.name ?? null;
    return this.itemsFor(memberId)
      .sort(byKeyThenId((i) => i.created_at ?? "", (i) => i.id))
      .map((i): ListedFeedItem => {
        const prickle = i.prickle_id ? this.data.prickles.find((p) => p.id === i.prickle_id) : undefined;
        const event = i.event_id ? this.data.events.find((e) => e.id === i.event_id && !e.deleted_at) : undefined;
        return {
          ...this.toRow(i),
          id: i.id,
          created_at: i.created_at ?? "",
          type_name: typeName(i.type_id),
          prickle: prickle ? { start_time: prickle.startTime, type_name: typeName(prickle.typeId) } : null,
          event: event ? { title: event.title, starts_at: event.starts_at ?? "", ends_at: event.ends_at ?? "" } : null,
        };
      });
  }

  async countItems(memberId: string) {
    return this.itemsFor(memberId).length;
  }

  async addItem(memberId: string, createdBy: string | null, item: NewFeedItem) {
    const row = this.toRow({ id: "", member_id: memberId, ...item, kind: item.kind });
    const same = this.itemsFor(memberId).some((i) => {
      const e = this.toRow(i);
      if (e.kind !== row.kind) return false;
      if (row.kind === "prickle") return e.prickle_id === row.prickle_id;
      if (row.kind === "event") return e.event_id === row.event_id;
      return e.type_id === row.type_id && e.day_of_week === row.day_of_week && e.start_time_local === row.start_time_local && e.timezone === row.timezone;
    });
    if (same) return "exists";
    this.data.calendarFeedItems.push({
      ...row,
      id: `cfi_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      created_by: createdBy,
      created_at: new Date().toISOString(),
    });
    return "added";
  }

  async removeItem(memberId: string, itemId: string) {
    this.data.calendarFeedItems = this.data.calendarFeedItems.filter((i) => !(i.id === itemId && i.member_id === memberId));
  }

  async memberIdsWithPrickle(prickleId: string) {
    return this.data.calendarFeedItems
      .filter((i) => i.kind === "prickle" && i.prickle_id === prickleId)
      .sort((a, b) => compareText(a.id, b.id))
      .map((i) => i.member_id);
  }

  async weeklySlotMembers(slot: { typeId: string; dayOfWeek: number; timezone: string }) {
    return this.data.calendarFeedItems
      .filter((i) => i.kind === "slot" && i.type_id === slot.typeId && i.day_of_week === slot.dayOfWeek && i.timezone === slot.timezone)
      .sort((a, b) => compareText(a.id, b.id))
      .map((i) => ({ memberId: i.member_id, startTimeLocal: withSeconds(i.start_time_local ?? null)! }));
  }
}
