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
  to: string;
  /** Include prickles starting exactly at `to` (default: the window is [from, to)). */
  inclusiveEnd?: boolean;
  /** Only these types. */
  typeIds?: string[];
  /** Only prickles this member is the assigned host of. */
  hostId?: string;
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
}

const TYPE_COLUMNS = "id, name, normalized_name, purpose, requires_host, solo_task_friendly";
// `host_id:host` keeps the host column's id next to the joined host record (which is also aliased `host`).
const DETAIL_SELECT = `id, type_id, host_id:host, title, start_time, end_time, source, calendar_event_id, prickle_type:prickle_types(${TYPE_COLUMNS}), host:prickle_host(id, name, display_name)`;

type TypeRow = {
  id: string;
  name: string;
  normalized_name: string;
  purpose: string;
  requires_host: boolean | null;
  solo_task_friendly: boolean;
};
type HostRow = { id: string; name: string; display_name: string | null };
type DetailRow = {
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
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

const toType = (row: TypeRow): PrickleType => ({
  id: row.id,
  name: row.name,
  normalizedName: row.normalized_name,
  purpose: row.purpose,
  requiresHost: row.requires_host ?? false,
  soloTaskFriendly: row.solo_task_friendly,
});

function toDetail(row: DetailRow): PrickleDetail {
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
          query = inclusiveEnd ? query.lte("start_time", to) : query.lt("start_time", to);
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
}

const byStartThenId = (a: PrickleDetail, b: PrickleDetail) =>
  a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** In-memory twin over an `InMemoryDataset`, joining types and hosts from it. */
export class InMemoryPrickleRepository implements PrickleRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private detail(prickle: Prickle): PrickleDetail {
    const type = this.data.prickleTypes.find((t) => t.id === prickle.typeId) ?? null;
    const host = prickle.hostId ? this.data.members.find((m) => m.id === prickle.hostId) : undefined;
    return {
      ...prickle,
      type: type ? { ...type } : null,
      host: host ? { id: host.id, name: host.name, displayName: host.displayName ?? null } : null,
    };
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
    const end = new Date(to).getTime();
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
}
