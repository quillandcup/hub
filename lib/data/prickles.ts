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
  /** A special session (webinar, pitch, goal review) the Events page calls out, not an everyday progress or sprint prickle. */
  listedInEvents: boolean;
  /** Included in public marketing (announced outside the community). */
  announcedPublicly: boolean;
  /** Non-members may attend. */
  guestsAllowed: boolean;
  /** What the type is, in a sentence or two; null when nobody wrote one. */
  description?: string | null;
  /** The member who hosts this kind of prickle unless someone else is assigned. */
  defaultHostId?: string | null;
  /** Other names the type goes by on calendar titles (normalized); only when read through `types()` or `typeById()`. */
  summaryAliases?: string[];
  /** The name after "w/" is a guest speaker rather than the host (educational prickles); only when read through `types()` or `typeById()`. */
  namesGuestSpeaker?: boolean;
};

/** What can change on a prickle type; a field left out is not changed, and null empties `description` and `defaultHostId`. */
export type PrickleTypePatch = Partial<Omit<PrickleType, "id">>;

/** A prickle type to add: a name, and any of the other fields (the rest takes the database defaults). */
export type NewPrickleType = PrickleTypePatch & { name: string; normalizedName: string };

/** Who hosts a prickle: the public part of the host's member record. */
export type PrickleHost = { id: string; name: string; displayName: string | null };

/** A scheduled prickle: one session on the calendar, from the calendar or from Zoom. */
export type Prickle = {
  id: string;
  typeId: string | null;
  /** Member id of the host; null when nobody is assigned. */
  hostId: string | null;
  title: string | null;
  /** What the host wrote about this session; null when nothing. */
  description?: string | null;
  /** Who the session is with when they are not the host (an invited speaker); null when nobody. */
  guestSpeaker?: string | null;
  startTime: string;
  endTime: string;
  source: string;
  calendarEventId: string | null;
  /** The Zoom meeting a Pop-Up Prickle (source "zoom") came from. */
  zoomMeetingUuid?: string | null;
  /** When the row was added; for the "last processed" readouts. */
  createdAt?: string | null;
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

/** How many prickles of one source have a host assigned, split by whether their type takes a host. */
export type HostCoverage = {
  total: number;
  requiresHost: { withHost: number; withoutHost: number };
  optionalHost: { withHost: number; withoutHost: number };
};

/** Just when a prickle ran and where it came from, for matching Zoom meetings to it. */
export type PrickleWindow = { id: string; startTime: string; endTime: string; source: string; zoomMeetingUuid: string | null };

/** A search over prickles by what they are called; see `PrickleRepository.search`. */
export type PrickleSearch = {
  /** Each word must match the prickle's title, its type's name, or the name of a member in that word's `hostIds` (looked up by the caller) who hosts it. */
  words: { text: string; hostIds: string[] }[];
  /** Only prickles one of these members hosts. */
  hostIds?: string[];
  /** Started at or after this instant (ISO). */
  after?: string;
  /** Started before this instant (ISO). */
  before?: string;
  limit: number;
  offset: number;
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
  /** The prickles made from these Bronze calendar events (`Prickle.calendarEventId`), in no particular order. */
  byCalendarEventIds(calendarEventIds: string[]): Promise<PrickleDetail[]>;
  /** Prickles that start in the window, oldest first. */
  startingBetween(window: StartingBetween): Promise<PrickleDetail[]>;
  /** Every prickle type, by name, with its calendar aliases and guest-speaker flag. */
  types(): Promise<PrickleType[]>;
  /** One prickle type, with its calendar aliases and guest-speaker flag; null when there is none. */
  typeById(id: string): Promise<PrickleType | null>;
  /** The types that need a host, by name: just the id and name, for pickers. */
  typesRequiringHost(): Promise<Pick<PrickleType, "id" | "name">[]>;
  /** The id of the type with this normalized name (other than `excludingId`), or null when none has it. */
  typeIdByNormalizedName(normalizedName: string, options?: { excludingId?: string }): Promise<string | null>;
  /** Adds a prickle type and returns it. */
  createType(type: NewPrickleType): Promise<PrickleType>;
  /** Changes a prickle type's fields (see `PrickleTypePatch`). */
  updateType(id: string, patch: PrickleTypePatch): Promise<void>;
  /** Hands the default host of every type one member is the default host of to another (merging duplicate members). */
  reassignDefaultHost(fromMemberId: string, toMemberId: string): Promise<void>;
  /** How many prickles the member is the assigned host of, past and future, or only those starting at or after `since` (ISO). */
  countHostedBy(memberId: string, options?: { since?: string }): Promise<number>;
  /** How many prickles came from this source (e.g. "calendar"). */
  countBySource(source: string): Promise<number>;
  /** Host and start time of every hosted prickle (those with an assigned host), optionally one member's. For hosting streaks. */
  hostedStartTimes(options?: { hostId?: string }): Promise<{ hostId: string; startTime: string }[]>;
  /** Prickles not over by `from` and starting no later than `to` (ISO): running at `from` or starting by `to`. Oldest first. */
  activeBetween(window: { from: string; to: string }): Promise<PrickleDetail[]>;
  /** Prickles matching every word (in the title, guest speaker, type name or a host's name; case-insensitive, wildcards typed as plain characters), newest first, `limit` of them from `offset`. */
  search(query: PrickleSearch): Promise<PrickleDetail[]>;
  /** How many calendar prickles with a type have no host, by type id (types with none are absent). */
  hostlessCalendarCountsByType(): Promise<Map<string, number>>;
  /** Calendar prickles of this type with no host, newest first, at most `limit`. */
  hostlessCalendarOfType(typeId: string, limit: number): Promise<PrickleDetail[]>;
  /** Calendar prickles that overlap the window (start before `to`, end after `from`; both exclusive, ISO), oldest first. Lean: no type or host joined. */
  calendarOverlapping(window: { from: string; to: string }): Promise<Pick<Prickle, "id" | "typeId" | "startTime" | "endTime">[]>;
  /** The prickles whose Zoom meeting is one of these, newest first. */
  byZoomMeetings(meetingUuids: string[]): Promise<PrickleDetail[]>;
  /** Host coverage of the prickles from this source (e.g. "calendar"). */
  hostCoverage(source: string): Promise<HostCoverage>;
  /** When the most recently added prickle from this source was added, or null if there are none. */
  lastCreatedAt(source: string): Promise<string | null>;
  /** Every prickle's time window and source, oldest first: a lean scan, without type or host. */
  timeWindows(): Promise<PrickleWindow[]>;
  /** The id of the prickle type with this normalized name, creating it (named `name`, with `description`) when there is none. */
  findOrCreateType(input: { name: string; normalizedName: string; description?: string }): Promise<string>;
  /** Adds prickles that came from the calendar and returns their ids in order. */
  createCalendarPrickles(rows: NewCalendarPrickle[]): Promise<string[]>;
  /** Gives a prickle another type. */
  setType(prickleId: string, typeId: string): Promise<void>;
  /** Gives a prickle another host. */
  setHost(prickleId: string, hostId: string): Promise<void>;
  /** Sets the title, description and guest speaker a prickle has; a field left out is not changed, and null empties it. */
  setText(prickleId: string, text: { title?: string | null; description?: string | null; guestSpeaker?: string | null }): Promise<void>;
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
   * Prickles of a type shown on the Events page (`PrickleType.listedInEvents`) that are not over by `from` and start no later
   * than `to` (ISO): running at `from` or starting by `to`. Oldest first, at most `limit`.
   */
  listedInEventsActiveBetween(options: { from: string; to: string; limit: number }): Promise<PrickleDetail[]>;
}

const TYPE_COLUMNS = "id, name, normalized_name, description, default_host_id, purpose, requires_host, solo_task_friendly, listed_in_events, announced_publicly, guests_allowed";
// `host_id:host` keeps the host column's id next to the joined host record (which is also aliased `host`).
const FULL_TYPE_COLUMNS = `${TYPE_COLUMNS}, summary_aliases, names_guest_speaker`;
const PRICKLE_COLUMNS = "id, type_id, host_id:host, title, description, guest_speaker, start_time, end_time, source, calendar_event_id, zoom_meeting_uuid";
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
  description: string | null;
  default_host_id: string | null;
  purpose: string;
  requires_host: boolean | null;
  solo_task_friendly: boolean;
  listed_in_events: boolean;
  announced_publicly: boolean;
  guests_allowed: boolean;
  // Only selected with FULL_TYPE_COLUMNS.
  summary_aliases?: string[] | null;
  names_guest_speaker?: boolean | null;
};
type HostRow = { id: string; name: string; display_name: string | null };
export type DetailRow = {
  id: string;
  type_id: string | null;
  host_id: string | null;
  title: string | null;
  description: string | null;
  guest_speaker: string | null;
  start_time: string;
  end_time: string;
  source: string;
  calendar_event_id: string | null;
  zoom_meeting_uuid: string | null;
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
  description: row.description,
  defaultHostId: row.default_host_id,
  soloTaskFriendly: row.solo_task_friendly,
  listedInEvents: row.listed_in_events,
  announcedPublicly: row.announced_publicly,
  guestsAllowed: row.guests_allowed,
  ...(row.summary_aliases !== undefined ? { summaryAliases: row.summary_aliases ?? [] } : {}),
  ...(row.names_guest_speaker !== undefined ? { namesGuestSpeaker: row.names_guest_speaker ?? false } : {}),
});

/** A type's changed fields as database columns. */
const typeColumns = (patch: PrickleTypePatch) => ({
  ...(patch.name !== undefined ? { name: patch.name } : {}),
  ...(patch.normalizedName !== undefined ? { normalized_name: patch.normalizedName } : {}),
  ...(patch.description !== undefined ? { description: patch.description } : {}),
  ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
  ...(patch.requiresHost !== undefined ? { requires_host: patch.requiresHost } : {}),
  ...(patch.soloTaskFriendly !== undefined ? { solo_task_friendly: patch.soloTaskFriendly } : {}),
  ...(patch.listedInEvents !== undefined ? { listed_in_events: patch.listedInEvents } : {}),
  ...(patch.announcedPublicly !== undefined ? { announced_publicly: patch.announcedPublicly } : {}),
  ...(patch.guestsAllowed !== undefined ? { guests_allowed: patch.guestsAllowed } : {}),
  ...(patch.defaultHostId !== undefined ? { default_host_id: patch.defaultHostId } : {}),
  ...(patch.summaryAliases !== undefined ? { summary_aliases: patch.summaryAliases } : {}),
  ...(patch.namesGuestSpeaker !== undefined ? { names_guest_speaker: patch.namesGuestSpeaker } : {}),
});

export function toDetail(row: DetailRow): PrickleDetail {
  const type = one(row.prickle_type);
  const host = one(row.host);
  return {
    id: row.id,
    typeId: row.type_id,
    hostId: row.host_id,
    title: row.title,
    description: row.description,
    guestSpeaker: row.guest_speaker,
    startTime: row.start_time,
    endTime: row.end_time,
    source: row.source,
    calendarEventId: row.calendar_event_id,
    zoomMeetingUuid: row.zoom_meeting_uuid,
    type: type ? toType(type) : null,
    host: host ? { id: host.id, name: host.name, displayName: host.display_name } : null,
  };
}

/** A typed word with the characters that mean something to PostgREST's filter syntax or to LIKE turned into spaces. */
const neutralize = (word: string) => word.replace(/[\\%_,()"]/g, " ").trim();

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

  async byCalendarEventIds(calendarEventIds: string[]): Promise<PrickleDetail[]> {
    const found: PrickleDetail[] = [];
    for (const idChunk of chunk(calendarEventIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<DetailRow>(
        (from, to) =>
          this.db.from("prickles").select(DETAIL_SELECT).in("calendar_event_id", idChunk).order("id").range(from, to) as unknown as PromiseLike<{
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
        this.db.from("prickle_types").select(FULL_TYPE_COLUMNS).order("name").order("id").range(from, to) as unknown as PromiseLike<{
          data: TypeRow[] | null;
          error: { message: string } | null;
        }>,
    );
    return rows.map(toType);
  }

  async typeById(id: string): Promise<PrickleType | null> {
    const { data, error } = await this.db.from("prickle_types").select(FULL_TYPE_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toType(data as unknown as TypeRow) : null;
  }

  async typesRequiringHost(): Promise<Pick<PrickleType, "id" | "name">[]> {
    return fetchAllRows<{ id: string; name: string }>(
      (from, to) =>
        this.db.from("prickle_types").select("id, name").eq("requires_host", true).order("name").order("id").range(from, to) as unknown as PromiseLike<{
          data: { id: string; name: string }[] | null;
          error: { message: string } | null;
        }>,
    );
  }

  async typeIdByNormalizedName(normalizedName: string, { excludingId }: { excludingId?: string } = {}): Promise<string | null> {
    let query = this.db.from("prickle_types").select("id").eq("normalized_name", normalizedName);
    if (excludingId) query = query.neq("id", excludingId);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.id ?? null;
  }

  async createType(type: NewPrickleType): Promise<PrickleType> {
    const { data, error } = await this.db
      .from("prickle_types")
      .insert(typeColumns(type) as { name: string; normalized_name: string })
      .select(FULL_TYPE_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Couldn't create the prickle type");
    return toType(data as unknown as TypeRow);
  }

  async updateType(id: string, patch: PrickleTypePatch): Promise<void> {
    const { error } = await this.db.from("prickle_types").update(typeColumns(patch)).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async reassignDefaultHost(fromMemberId: string, toMemberId: string): Promise<void> {
    const { error } = await this.db.from("prickle_types").update({ default_host_id: toMemberId }).eq("default_host_id", fromMemberId);
    if (error) throw new Error(error.message);
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

  async setHost(prickleId: string, hostId: string): Promise<void> {
    const { error } = await this.db.from("prickles").update({ host: hostId }).eq("id", prickleId);
    if (error) throw new Error(error.message);
  }

  async setType(prickleId: string, typeId: string): Promise<void> {
    const { error } = await this.db.from("prickles").update({ type_id: typeId }).eq("id", prickleId);
    if (error) throw new Error(error.message);
  }

  async setText(prickleId: string, text: { title?: string | null; description?: string | null; guestSpeaker?: string | null }): Promise<void> {
    const update = {
      ...(text.title !== undefined ? { title: text.title } : {}),
      ...(text.description !== undefined ? { description: text.description } : {}),
      ...(text.guestSpeaker !== undefined ? { guest_speaker: text.guestSpeaker } : {}),
    };
    if (Object.keys(update).length === 0) return;
    const { error } = await this.db.from("prickles").update(update).eq("id", prickleId);
    if (error) throw new Error(error.message);
  }

  async reassignHost(fromMemberId: string, toMemberId: string): Promise<void> {
    const { error } = await this.db.from("prickles").update({ host: toMemberId }).eq("host", fromMemberId);
    if (error) throw new Error(error.message);
  }

  async hostlessCalendarCountsByType(): Promise<Map<string, number>> {
    const rows = await fetchAllRows<{ type_id: string }>(
      (from, to) =>
        this.db.from("prickles").select("type_id").eq("source", "calendar").is("host", null).not("type_id", "is", null).order("id").range(from, to) as unknown as PromiseLike<{
          data: { type_id: string }[] | null;
          error: { message: string } | null;
        }>,
    );
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.type_id, (counts.get(row.type_id) ?? 0) + 1);
    return counts;
  }

  async hostlessCalendarOfType(typeId: string, limit: number): Promise<PrickleDetail[]> {
    const { data, error } = await this.db
      .from("prickles")
      .select(DETAIL_SELECT)
      .eq("type_id", typeId)
      .eq("source", "calendar")
      .is("host", null)
      .order("start_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as DetailRow[]).map(toDetail);
  }

  async calendarOverlapping({ from, to }: { from: string; to: string }) {
    const rows = await fetchAllRows<{ id: string; type_id: string | null; start_time: string; end_time: string }>(
      (start, end) =>
        this.db
          .from("prickles")
          .select("id, type_id, start_time, end_time")
          .eq("source", "calendar")
          .lt("start_time", to)
          .gt("end_time", from)
          .order("start_time")
          .order("id")
          .range(start, end) as unknown as PromiseLike<{
          data: { id: string; type_id: string | null; start_time: string; end_time: string }[] | null;
          error: { message: string } | null;
        }>,
    );
    return rows.map((r) => ({ id: r.id, typeId: r.type_id, startTime: r.start_time, endTime: r.end_time }));
  }

  async byZoomMeetings(meetingUuids: string[]): Promise<PrickleDetail[]> {
    const found: PrickleDetail[] = [];
    for (const uuidChunk of chunk(meetingUuids, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<DetailRow>(
        (from, to) =>
          this.db.from("prickles").select(DETAIL_SELECT).in("zoom_meeting_uuid", uuidChunk).order("id").range(from, to) as unknown as PromiseLike<{
            data: DetailRow[] | null;
            error: { message: string } | null;
          }>,
      );
      found.push(...rows.map(toDetail));
    }
    return found.sort((a, b) => -byStartThenId(a, b));
  }

  async hostCoverage(source: string): Promise<HostCoverage> {
    const count = async (host: "with" | "without", requiresHost?: boolean) => {
      let query =
        requiresHost === undefined
          ? this.db.from("prickles").select("id", { count: "exact", head: true })
          : this.db.from("prickles").select("id, prickle_types!inner(requires_host)", { count: "exact", head: true });
      query = query.eq("source", source);
      query = host === "with" ? query.not("host", "is", null) : query.is("host", null);
      if (requiresHost !== undefined) query = query.eq("prickle_types.requires_host", requiresHost);
      const { count: n, error } = await query;
      if (error) throw new Error(error.message);
      return n ?? 0;
    };
    const [total, reqWith, reqWithout, optWith, optWithout] = await Promise.all([
      this.countBySource(source),
      count("with", true),
      count("without", true),
      count("with", false),
      count("without", false),
    ]);
    return { total, requiresHost: { withHost: reqWith, withoutHost: reqWithout }, optionalHost: { withHost: optWith, withoutHost: optWithout } };
  }

  async lastCreatedAt(source: string): Promise<string | null> {
    const { data, error } = await this.db.from("prickles").select("created_at").eq("source", source).order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.created_at ?? null;
  }

  async timeWindows(): Promise<PrickleWindow[]> {
    const rows = await fetchAllRows<{ id: string; start_time: string; end_time: string; source: string; zoom_meeting_uuid: string | null }>(
      (from, to) =>
        this.db
          .from("prickles")
          .select("id, start_time, end_time, zoom_meeting_uuid, source")
          .order("start_time")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{
          data: { id: string; start_time: string; end_time: string; source: string; zoom_meeting_uuid: string | null }[] | null;
          error: { message: string } | null;
        }>,
    );
    return rows.map((r) => ({ id: r.id, startTime: r.start_time, endTime: r.end_time, source: r.source, zoomMeetingUuid: r.zoom_meeting_uuid }));
  }

  async search({ words, hostIds, after, before, limit, offset }: PrickleSearch): Promise<PrickleDetail[]> {
    if (hostIds && hostIds.length === 0) return [];
    // A type counts for a word when its name contains it.
    const typeIdsByWord = await Promise.all(
      words.map(async (w) => {
        const { data, error } = await this.db.from("prickle_types").select("id").ilike("name", `%${neutralize(w.text)}%`).limit(50);
        if (error) throw new Error(error.message);
        return (data ?? []).map((t) => t.id);
      }),
    );
    let query = this.db.from("prickles").select(DETAIL_SELECT);
    if (hostIds) query = query.in("host", hostIds);
    words.forEach((w, i) => {
      // One .or() per word: PostgREST ANDs separate filters.
      const ors = [
        `title.ilike."%${neutralize(w.text)}%"`,
        `guest_speaker.ilike."%${neutralize(w.text)}%"`,
        typeIdsByWord[i].length ? `type_id.in.(${typeIdsByWord[i].join(",")})` : null,
        w.hostIds.length ? `host.in.(${w.hostIds.join(",")})` : null,
      ].filter(Boolean);
      query = query.or(ors.join(","));
    });
    if (after) query = query.gte("start_time", after);
    if (before) query = query.lt("start_time", before);
    const { data, error } = await query.order("start_time", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as DetailRow[]).map(toDetail);
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

  async listedInEventsActiveBetween({ from, to, limit }: { from: string; to: string; limit: number }): Promise<PrickleDetail[]> {
    const { data: types, error: typeError } = await this.db.from("prickle_types").select("id").eq("listed_in_events", true);
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

const byNameThenId = (a: PrickleType, b: PrickleType) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The fields of a patch that were given (not undefined). */
const definedFields = <T extends object>(patch: T): Partial<T> => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

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

  async byCalendarEventIds(calendarEventIds: string[]) {
    const wanted = new Set(calendarEventIds);
    return this.data.prickles.filter((p) => p.calendarEventId !== null && wanted.has(p.calendarEventId)).map((p) => this.detail(p));
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

  private full(type: PrickleType): PrickleType {
    return { ...type, summaryAliases: [...(type.summaryAliases ?? [])], namesGuestSpeaker: type.namesGuestSpeaker ?? false };
  }

  async types() {
    return this.data.prickleTypes.map((t) => this.full(t)).sort(byNameThenId);
  }

  async typeById(id: string) {
    const type = this.data.prickleTypes.find((t) => t.id === id);
    return type ? this.full(type) : null;
  }

  async typesRequiringHost() {
    return this.data.prickleTypes
      .filter((t) => t.requiresHost)
      .sort(byNameThenId)
      .map((t) => ({ id: t.id, name: t.name }));
  }

  async typeIdByNormalizedName(normalizedName: string, { excludingId }: { excludingId?: string } = {}) {
    return this.data.prickleTypes.find((t) => t.normalizedName === normalizedName && t.id !== excludingId)?.id ?? null;
  }

  async createType(type: NewPrickleType) {
    const created: PrickleType = {
      purpose: "writing",
      requiresHost: true, // the column's default
      soloTaskFriendly: true, // the column's default
      listedInEvents: false,
      announcedPublicly: false,
      guestsAllowed: false,
      description: null,
      defaultHostId: null,
      ...definedFields(type),
      name: type.name,
      normalizedName: type.normalizedName,
      id: `prty_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    };
    this.data.prickleTypes.push(created);
    return this.full(created);
  }

  async updateType(id: string, patch: PrickleTypePatch) {
    const type = this.data.prickleTypes.find((t) => t.id === id);
    if (type) Object.assign(type, definedFields(patch));
  }

  async reassignDefaultHost(fromMemberId: string, toMemberId: string) {
    for (const t of this.data.prickleTypes) if (t.defaultHostId === fromMemberId) t.defaultHostId = toMemberId;
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

  async setHost(prickleId: string, hostId: string) {
    const prickle = this.data.prickles.find((p) => p.id === prickleId);
    if (prickle) prickle.hostId = hostId;
  }

  async setType(prickleId: string, typeId: string) {
    const prickle = this.data.prickles.find((p) => p.id === prickleId);
    if (prickle) prickle.typeId = typeId;
  }

  async setText(prickleId: string, text: { title?: string | null; description?: string | null; guestSpeaker?: string | null }) {
    const prickle = this.data.prickles.find((p) => p.id === prickleId);
    if (!prickle) return;
    if (text.title !== undefined) prickle.title = text.title;
    if (text.description !== undefined) prickle.description = text.description;
    if (text.guestSpeaker !== undefined) prickle.guestSpeaker = text.guestSpeaker;
  }

  async reassignHost(fromMemberId: string, toMemberId: string) {
    for (const p of this.data.prickles) if (p.hostId === fromMemberId) p.hostId = toMemberId;
  }

  async hostlessCalendarCountsByType() {
    const counts = new Map<string, number>();
    for (const p of this.data.prickles) {
      if (p.source === "calendar" && p.hostId === null && p.typeId !== null) counts.set(p.typeId, (counts.get(p.typeId) ?? 0) + 1);
    }
    return counts;
  }

  async hostlessCalendarOfType(typeId: string, limit: number) {
    return this.data.prickles
      .filter((p) => p.source === "calendar" && p.hostId === null && p.typeId === typeId)
      .sort((a, b) => -byStartThenId(a, b))
      .slice(0, limit)
      .map((p) => this.detail(p));
  }

  async calendarOverlapping({ from, to }: { from: string; to: string }) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.data.prickles
      .filter((p) => p.source === "calendar" && new Date(p.startTime).getTime() < end && new Date(p.endTime).getTime() > start)
      .sort(byStartThenId)
      .map((p) => ({ id: p.id, typeId: p.typeId, startTime: p.startTime, endTime: p.endTime }));
  }

  async byZoomMeetings(meetingUuids: string[]) {
    const wanted = new Set(meetingUuids);
    return this.data.prickles
      .filter((p) => p.zoomMeetingUuid && wanted.has(p.zoomMeetingUuid))
      .sort((a, b) => -byStartThenId(a, b))
      .map((p) => this.detail(p));
  }

  async hostCoverage(source: string): Promise<HostCoverage> {
    const types = new Map(this.data.prickleTypes.map((t) => [t.id, t.requiresHost]));
    const coverage: HostCoverage = { total: 0, requiresHost: { withHost: 0, withoutHost: 0 }, optionalHost: { withHost: 0, withoutHost: 0 } };
    for (const p of this.data.prickles) {
      if (p.source !== source) continue;
      coverage.total++;
      const requires = p.typeId === null ? undefined : types.get(p.typeId);
      if (requires === undefined) continue; // no type: counted in the total only
      const group = requires ? coverage.requiresHost : coverage.optionalHost;
      if (p.hostId) group.withHost++;
      else group.withoutHost++;
    }
    return coverage;
  }

  async lastCreatedAt(source: string) {
    const times = this.data.prickles.filter((p) => p.source === source && p.createdAt).map((p) => p.createdAt as string);
    return times.length ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
  }

  async timeWindows() {
    return [...this.data.prickles]
      .sort(byStartThenId)
      .map((p) => ({ id: p.id, startTime: p.startTime, endTime: p.endTime, source: p.source, zoomMeetingUuid: p.zoomMeetingUuid ?? null }));
  }

  async search({ words, hostIds, after, before, limit, offset }: PrickleSearch) {
    if (hostIds && hostIds.length === 0) return [];
    const contains = (text: string | null | undefined, word: string) => (text ?? "").toLowerCase().includes(neutralize(word).toLowerCase());
    const hostSet = hostIds ? new Set(hostIds) : null;
    const afterMs = after ? new Date(after).getTime() : -Infinity;
    const beforeMs = before ? new Date(before).getTime() : Infinity;
    return this.data.prickles
      .filter((p) => {
        const start = new Date(p.startTime).getTime();
        if (start < afterMs || start >= beforeMs) return false;
        if (hostSet && !(p.hostId && hostSet.has(p.hostId))) return false;
        const type = this.data.prickleTypes.find((t) => t.id === p.typeId);
        return words.every((w) => contains(p.title, w.text) || contains(p.guestSpeaker, w.text) || contains(type?.name, w.text) || (!!p.hostId && w.hostIds.includes(p.hostId)));
      })
      .sort((a, b) => -byStartThenId(a, b))
      .slice(offset, offset + limit)
      .map((p) => this.detail(p));
  }

  async findOrCreateType({ name, normalizedName, description }: { name: string; normalizedName: string; description?: string }) {
    const existing = this.data.prickleTypes.find((t) => t.normalizedName === normalizedName);
    if (existing) return existing.id;
    const id = `prty_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.data.prickleTypes.push({ id, name, normalizedName, description: description ?? null, purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false });
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

  async listedInEventsActiveBetween({ from, to, limit }: { from: string; to: string; limit: number }) {
    const typeIds = new Set(this.data.prickleTypes.filter((t) => t.listedInEvents).map((t) => t.id));
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.data.prickles
      .filter((p) => p.typeId !== null && typeIds.has(p.typeId) && new Date(p.endTime).getTime() >= start && new Date(p.startTime).getTime() <= end)
      .sort(byStartThenId)
      .slice(0, limit)
      .map((p) => this.detail(p));
  }
}
