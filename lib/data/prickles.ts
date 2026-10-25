import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit even with long ids. */
const ID_CHUNK_SIZE = 100;

/** A kind of prickle ("Sprint Writing", "Coworking"...). */
export type PrickleType = {
  id: string;
  name: string;
  normalizedName: string;
  /** What the prickle is for, e.g. "writing"; decides what counts toward writing habits. */
  purpose: string;
  requiresHost: boolean;
  soloTaskFriendly: boolean;
};

/** Who hosts a prickle: the public part of the host's member record. */
export type PrickleHost = { id: string; name: string; displayName: string | null };

/** A scheduled prickle: one session on the calendar, from the calendar or from Zoom. */
export type Prickle = {
  id: string;
  typeId: string | null;
  /** Member id of the host; null when nobody is assigned. */
  hostId: string | null;
  title: string | null;
  startTime: string;
  endTime: string;
  source: string;
  calendarEventId: string | null;
};

/** A prickle with its type and host joined in, the shape nearly every page wants. */
export type PrickleDetail = Prickle & { type: PrickleType | null; host: PrickleHost | null };

/** Prickles whose start time falls in a window; ordered by start time, then id. */
export type StartingBetween = {
  from: string;
  /** No later than this; leave out for "from then on". */
  to?: string;
  /** Include prickles starting exactly at `to` (default: the window is [from, to)). */
  inclusiveEnd?: boolean;
  /** Only these types. */
  typeIds?: string[];
  /** Only prickles this member is the assigned host of. */
  hostId?: string;
};

/** A prickle to add from the calendar; the rest takes the database defaults. */
export type NewCalendarPrickle = {
  typeId: string;
  hostId: string | null;
  description?: string | null;
  startTime: string;
  endTime: string;
};

/**
 * Everything the app asks of `prickles` and `prickle_types`. Reads return `PrickleDetail`
 * (type and host joined) so callers never reach for PostgREST embeds themselves.
 */
export interface PrickleRepository {
  byId(id: string): Promise<PrickleDetail | null>;
  /** The prickles that exist among these ids, in no particular order. */
  byIds(ids: string[]): Promise<PrickleDetail[]>;
  /** Prickles that start in the window, oldest first. */
  startingBetween(window: StartingBetween): Promise<PrickleDetail[]>;
  /** Every prickle type, by name. */
  types(): Promise<PrickleType[]>;
  /** How many prickles the member is the assigned host of, past and future, or only those starting at or after `since` (ISO). */
  countHostedBy(memberId: string, options?: { since?: string }): Promise<number>;
  /** How many prickles came from this source (e.g. "calendar"). */
  countBySource(source: string): Promise<number>;
  /** Host and start time of every hosted prickle (those with an assigned host), optionally one member's. For hosting streaks. */
  hostedStartTimes(options?: { hostId?: string }): Promise<{ hostId: string; startTime: string }[]>;
  /** Prickles not over by `from` and starting no later than `to` (ISO): running at `from` or starting by `to`. Oldest first. */
  activeBetween(window: { from: string; to: string }): Promise<PrickleDetail[]>;
  /** The id of the prickle type with this normalized name, creating it (named `name`, with `description`) when there is none. */
  findOrCreateType(input: { name: string; normalizedName: string; description?: string }): Promise<string>;
  /** Adds prickles that came from the calendar and returns their ids in order. */
  createCalendarPrickles(rows: NewCalendarPrickle[]): Promise<string[]>;
  /** Hands every prickle one member hosts to another (merging duplicate members). */
  reassignHost(fromMemberId: string, toMemberId: string): Promise<void>;
  /** How many different members have ever been the assigned host of a prickle. */
  distinctHostCount(): Promise<number>;
  /** The first prickle starting at or after `instant` (ISO), else the latest one there is; null when there are none. */
  nextOrMostRecent(instant: string): Promise<PrickleDetail | null>;
  /** The prickle running at this instant (ISO; started at or before it, not yet ended), the earliest-starting one; null if none. */
  inProgressAt(instant: string): Promise<PrickleDetail | null>;
  /** How many prickles each of these members hosted among those that started before `before` (ISO); every member asked about is present, 0 if none. */
  hostedCounts(hostIds: string[], before: string): Promise<Map<string, number>>;
  /**
   * Prickles of the type with this normalized name that are not over by `from` and start no later than
   * `to` (ISO): running at `from` or starting by `to`. Oldest first, at most `limit`.
   */
  ofTypeActiveBetween(options: { normalizedName: string; from: string; to: string; limit: number }): Promise<PrickleDetail[]>;
}

const TYPE_COLUMNS = "id, name, normalized_name, purpose, requires_host, solo_task_friendly";
// `host_id:host` keeps the host column's id next to the joined host record (which is also aliased `host`).
const PRICKLE_COLUMNS = "id, type_id, host_id:host, title, start_time, end_time, source, calendar_event_id";
const HOST_EMBED = "host:prickle_host(id, name, display_name)";
const DETAIL_SELECT = `${PRICKLE_COLUMNS}, prickle_type:prickle_types(${TYPE_COLUMNS}), ${HOST_EMBED}`;

/**
 * The select for a prickle with its type and host, to embed under another table (attendance).
 * `inner` drops rows whose prickle or type doesn't match the filters the caller adds.
 */
export const prickleEmbed = (inner: boolean) =>
  `prickles${inner ? "!inner" : ""}(${PRICKLE_COLUMNS}, prickle_type:prickle_types${inner ? "!inner" : ""}(${TYPE_COLUMNS}), ${HOST_EMBED})`;

type TypeRow = {
  id: string;
  name: string;
  normalized_name: string;
  purpose: string;
  requires_host: boolean | null;
  solo_task_friendly: boolean;
};
type HostRow = { id: string; name: string; display_name: string | null };
export type DetailRow = {
  id: string;
  type_id: string | null;
  host_id: string | null;
  title: string | null;
  start_time: string;
  end_time: string;
  source: string;
  calendar_event_id: string | null;
  prickle_type: TypeRow | TypeRow[] | null;
  host: HostRow | HostRow[] | null;
};

// PostgREST returns an embedded to-one relation as an object, but typed clients may see an array.
export const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

const toType = (row: TypeRow): PrickleType => ({
  id: row.id,
  name: row.name,
  normalizedName: row.normalized_name,
  purpose: row.purpose,
  requiresHost: row.requires_host ?? false,
  soloTaskFriendly: row.solo_task_friendly,
});

export function toDetail(row: DetailRow): PrickleDetail {
  const type = one(row.prickle_type);
  const host = one(row.host);
  return {
    id: row.id,
    typeId: row.type_id,
    hostId: row.host_id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    source: row.source,
    calendarEventId: row.calendar_event_id,
    type: type ? toType(type) : null,
    host: host ? { id: host.id, name: host.name, displayName: host.display_name } : null,
  };
}

export class SupabasePrickleRepository implements PrickleRepository {
  constructor(private readonly db: Db) {}

  async byId(id: string): Promise<PrickleDetail | null> {
    const { data, error } = await this.db.from("prickles").select(DETAIL_SELECT).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toDetail(data as unknown as DetailRow) : null;
  }

  async byIds(ids: string[]): Promise<PrickleDetail[]> {
    const found: PrickleDetail[] = [];
    for (const idChunk of chunk(ids, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<DetailRow>(
        (from, to) =>
          this.db.from("prickles").select(DETAIL_SELECT).in("id", idChunk).order("id").range(from, to) as unknown as PromiseLike<{
            data: DetailRow[] | null;
            error: { message: string } | null;
          }>,
      );
      found.push(...rows.map(toDetail));
    }
    return found;
  }

  async startingBetween({ from, to, inclusiveEnd = false, typeIds, hostId }: StartingBetween): Promise<PrickleDetail[]> {
    if (typeIds && typeIds.length === 0) return [];
    const rows: DetailRow[] = [];
    // Type ids are filtered in chunks like any `.in()`; each chunk is paged, and the merge below restores the order.
    for (const typeChunk of typeIds ? chunk(typeIds, ID_CHUNK_SIZE) : [undefined]) {
      rows.push(
        ...(await fetchAllRows<DetailRow>((start, end) => {
          let query = this.db.from("prickles").select(DETAIL_SELECT).gte("start_time", from);
          if (to !== undefined) query = inclusiveEnd ? query.lte("start_time", to) : query.lt("start_time", to);
          if (typeChunk) query = query.in("type_id", typeChunk);
          if (hostId) query = query.eq("host", hostId);
          return query.order("start_time").order("id").range(start, end) as unknown as PromiseLike<{
            data: DetailRow[] | null;
            error: { message: string } | null;
          }>;
        })),
      );
    }
    const details = rows.map(toDetail);
    return typeIds && typeIds.length > ID_CHUNK_SIZE ? details.sort(byStartThenId) : details;
  }

  async types(): Promise<PrickleType[]> {
    const rows = await fetchAllRows<TypeRow>(
      (from, to) =>
        this.db.from("prickle_types").select(TYPE_COLUMNS).order("name").order("id").range(from, to) as unknown as PromiseLike<{
          data: TypeRow[] | null;
          error: { message: string } | null;
        }>,
    );
    return rows.map(toType);
  }

  async countHostedBy(memberId: string, { since }: { since?: string } = {}): Promise<number> {
    let query = this.db.from("prickles").select("id", { count: "exact", head: true }).eq("host", memberId);
    if (since) query = query.gte("start_time", since);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countBySource(source: string): Promise<number> {
    const { count, error } = await this.db.from("prickles").select("id", { count: "exact", head: true }).eq("source", source);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async hostedStartTimes({ hostId }: { hostId?: string } = {}): Promise<{ hostId: string; startTime: string }[]> {
    const rows = await fetchAllRows<{ host: string; start_time: string }>((from, to) => {
      let query = this.db.from("prickles").select("host, start_time").not("host", "is", null);
      if (hostId) query = query.eq("host", hostId);
      return query.order("id").range(from, to) as unknown as PromiseLike<{
        data: { host: string; start_time: string }[] | null;
        error: { message: string } | null;
      }>;
    });
    return rows.map((r) => ({ hostId: r.host, startTime: r.start_time }));
  }

  async reassignHost(fromMemberId: string, toMemberId: string): Promise<void> {
    const { error } = await this.db.from("prickles").update({ host: toMemberId }).eq("host", fromMemberId);
    if (error) throw new Error(error.message);
  }

  async findOrCreateType({ name, normalizedName, description }: { name: string; normalizedName: string; description?: string }): Promise<string> {
    const { data: existing, error: findError } = await this.db.from("prickle_types").select("id").eq("normalized_name", normalizedName).maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existing) return existing.id;
    const { data: created, error } = await this.db
      .from("prickle_types")
      .insert({ name, normalized_name: normalizedName, ...(description ? { description } : {}) })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Couldn't create the prickle type");
    return created.id;
  }

  async createCalendarPrickles(rows: NewCalendarPrickle[]): Promise<string[]> {
    const ids: string[] = [];
    for (const batch of chunk(rows, 500)) {
      const { data, error } = await this.db
        .from("prickles")
        .insert(
          batch.map((r) => ({
            type_id: r.typeId,
            host: r.hostId,
            description: r.description ?? null,
            start_time: r.startTime,
            end_time: r.endTime,
            source: "calendar",
          })),
        )
        .select("id");
      if (error) throw new Error(error.message);
      ids.push(...(data ?? []).map((r) => r.id));
    }
    return ids;
  }

  async activeBetween({ from, to }: { from: string; to: string }): Promise<PrickleDetail[]> {
    const rows = await fetchAllRows<DetailRow>(
      (start, end) =>
        this.db
          .from("prickles")
          .select(DETAIL_SELECT)
          .gte("end_time", from)
          .lte("start_time", to)
          .order("start_time")
          .order("id")
          .range(start, end) as unknown as PromiseLike<{ data: DetailRow[] | null; error: { message: string } | null }>,
    );
    return rows.map(toDetail);
  }

  async distinctHostCount(): Promise<number> {
    return new Set((await this.hostedStartTimes()).map((h) => h.hostId)).size;
  }

  async nextOrMostRecent(instant: string): Promise<PrickleDetail | null> {
    const next = await this.db.from("prickles").select(DETAIL_SELECT).gte("start_time", instant).order("start_time").order("id").limit(1);
    if (next.error) throw new Error(next.error.message);
    let row = (next.data ?? [])[0];
    if (!row) {
      const latest = await this.db.from("prickles").select(DETAIL_SELECT).order("start_time", { ascending: false }).order("id", { ascending: false }).limit(1);
      if (latest.error) throw new Error(latest.error.message);
      row = (latest.data ?? [])[0];
    }
    return row ? toDetail(row as unknown as DetailRow) : null;
  }

  async inProgressAt(instant: string): Promise<PrickleDetail | null> {
    const { data, error } = await this.db
      .from("prickles")
      .select(DETAIL_SELECT)
      .lte("start_time", instant)
      .gt("end_time", instant)
      .order("start_time")
      .order("id")
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? toDetail(row as unknown as DetailRow) : null;
  }

  async hostedCounts(hostIds: string[], before: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>(hostIds.map((id) => [id, 0]));
    for (const hostChunk of chunk(hostIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<{ host: string }>(
        (from, to) =>
          this.db.from("prickles").select("host").in("host", hostChunk).lt("start_time", before).order("id").range(from, to) as unknown as PromiseLike<{
            data: { host: string }[] | null;
            error: { message: string } | null;
          }>,
      );
      for (const row of rows) counts.set(row.host, (counts.get(row.host) ?? 0) + 1);
    }
    return counts;
  }

  async ofTypeActiveBetween({ normalizedName, from, to, limit }: { normalizedName: string; from: string; to: string; limit: number }): Promise<PrickleDetail[]> {
    const { data: types, error: typeError } = await this.db.from("prickle_types").select("id").eq("normalized_name", normalizedName);
    if (typeError) throw new Error(typeError.message);
    const typeIds = (types ?? []).map((t) => t.id);
    if (typeIds.length === 0) return [];
    const { data, error } = await this.db
      .from("prickles")
      .select(DETAIL_SELECT)
      .in("type_id", typeIds)
      .gte("end_time", from)
      .lte("start_time", to)
      .order("start_time")
      .order("id")
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as DetailRow[]).map(toDetail);
  }
}

const byStartThenId = (a: Prickle, b: Prickle) =>
  a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** A prickle with its type and host joined in from an in-memory dataset. */
export function prickleDetail(data: InMemoryDataset, prickle: Prickle): PrickleDetail {
  const type = data.prickleTypes.find((t) => t.id === prickle.typeId) ?? null;
  const host = prickle.hostId ? data.members.find((m) => m.id === prickle.hostId) : undefined;
  return {
    ...prickle,
    type: type ? { ...type } : null,
    host: host ? { id: host.id, name: host.name, displayName: host.displayName ?? null } : null,
  };
}

/** In-memory twin over an `InMemoryDataset`, joining types and hosts from it. */
export class InMemoryPrickleRepository implements PrickleRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private detail(prickle: Prickle): PrickleDetail {
    return prickleDetail(this.data, prickle);
  }

  async byId(id: string) {
    const prickle = this.data.prickles.find((p) => p.id === id);
    return prickle ? this.detail(prickle) : null;
  }

  async byIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.data.prickles.filter((p) => wanted.has(p.id)).map((p) => this.detail(p));
  }

  async startingBetween({ from, to, inclusiveEnd = false, typeIds, hostId }: StartingBetween) {
    const start = new Date(from).getTime();
    const end = to === undefined ? Infinity : new Date(to).getTime();
    const types = typeIds ? new Set(typeIds) : null;
    return this.data.prickles
      .filter((p) => {
        const at = new Date(p.startTime).getTime();
        return at >= start && (inclusiveEnd ? at <= end : at < end) && (!types || (p.typeId !== null && types.has(p.typeId))) && (!hostId || p.hostId === hostId);
      })
      .map((p) => this.detail(p))
      .sort(byStartThenId);
  }

  async types() {
    return this.data.prickleTypes.map((t) => ({ ...t })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async countHostedBy(memberId: string, { since }: { since?: string } = {}) {
    const from = since ? new Date(since).getTime() : -Infinity;
    return this.data.prickles.filter((p) => p.hostId === memberId && new Date(p.startTime).getTime() >= from).length;
  }

  async countBySource(source: string) {
    return this.data.prickles.filter((p) => p.source === source).length;
  }

  async hostedStartTimes({ hostId }: { hostId?: string } = {}) {
    return this.data.prickles
      .filter((p): p is typeof p & { hostId: string } => p.hostId !== null && (!hostId || p.hostId === hostId))
      .map((p) => ({ hostId: p.hostId, startTime: p.startTime }));
  }

  async reassignHost(fromMemberId: string, toMemberId: string) {
    for (const p of this.data.prickles) if (p.hostId === fromMemberId) p.hostId = toMemberId;
  }

  async findOrCreateType({ name, normalizedName }: { name: string; normalizedName: string; description?: string }) {
    const existing = this.data.prickleTypes.find((t) => t.normalizedName === normalizedName);
    if (existing) return existing.id;
    const id = `prty_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.data.prickleTypes.push({ id, name, normalizedName, purpose: "writing", requiresHost: false, soloTaskFriendly: false });
    return id;
  }

  async createCalendarPrickles(rows: NewCalendarPrickle[]) {
    return rows.map((r) => {
      const id = `prkl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      this.data.prickles.push({
        id,
        typeId: r.typeId,
        hostId: r.hostId,
        title: null,
        startTime: r.startTime,
        endTime: r.endTime,
        source: "calendar",
        calendarEventId: null,
      });
      return id;
    });
  }

  async activeBetween({ from, to }: { from: string; to: string }) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.data.prickles
      .filter((p) => new Date(p.endTime).getTime() >= start && new Date(p.startTime).getTime() <= end)
      .sort(byStartThenId)
      .map((p) => this.detail(p));
  }

  async distinctHostCount() {
    return new Set((await this.hostedStartTimes()).map((h) => h.hostId)).size;
  }

  async nextOrMostRecent(instant: string) {
    const at = new Date(instant).getTime();
    const sorted = [...this.data.prickles].sort(byStartThenId);
    const next = sorted.find((p) => new Date(p.startTime).getTime() >= at);
    const chosen = next ?? sorted[sorted.length - 1];
    return chosen ? this.detail(chosen) : null;
  }

  async inProgressAt(instant: string) {
    const at = new Date(instant).getTime();
    const running = this.data.prickles
      .filter((p) => new Date(p.startTime).getTime() <= at && new Date(p.endTime).getTime() > at)
      .sort(byStartThenId);
    return running[0] ? this.detail(running[0]) : null;
  }

  async hostedCounts(hostIds: string[], before: string) {
    const cutoff = new Date(before).getTime();
    const counts = new Map<string, number>(hostIds.map((id) => [id, 0]));
    for (const p of this.data.prickles) {
      if (p.hostId && counts.has(p.hostId) && new Date(p.startTime).getTime() < cutoff) counts.set(p.hostId, counts.get(p.hostId)! + 1);
    }
    return counts;
  }

  async ofTypeActiveBetween({ normalizedName, from, to, limit }: { normalizedName: string; from: string; to: string; limit: number }) {
    const typeIds = new Set(this.data.prickleTypes.filter((t) => t.normalizedName === normalizedName).map((t) => t.id));
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.data.prickles
      .filter((p) => p.typeId !== null && typeIds.has(p.typeId) && new Date(p.endTime).getTime() >= start && new Date(p.startTime).getTime() <= end)
      .sort(byStartThenId)
      .slice(0, limit)
      .map((p) => this.detail(p));
  }
}
