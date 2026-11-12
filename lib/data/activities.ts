import { latestParticipation, PARTICIPATION_TYPES, type Participation } from "@/lib/care-participation";
import { ENGAGEMENT_WINDOW_DAYS } from "@/lib/member-engagement";
import { pageBounds } from "@/lib/pagination";
import type { SlackPageQuery, SlackSortColumn } from "@/lib/slack-activity-table";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { inChunks } from "./query";
import type { Json } from "./database.types";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A stored activity row, as the database has it. */
export type ActivityRow = Row<"member_activities">;

/** What a feature records about a member (one row in the activity log, docs/ACTIVITY_AND_AUDIT_LOG.md). */
export interface NewActivity {
  memberId: string;
  type: string;
  category: string;
  title: string;
  occurredAt: string;
  source: string;
  relatedId?: string | null;
  description?: string | null;
  engagementValue?: number;
  /** "member" unless a feature says otherwise ("staff" when an admin acts for or as the member). */
  actorKind?: string;
  actorUserId?: string | null;
  durationMinutes?: number | null;
  prickleId?: string | null;
  data?: Json | null;
}

/** The slice of an activity the engagement metrics need. */
export interface EngagementRow {
  member_id: string;
  activity_type: string;
  engagement_value: number | null;
  occurred_at: string;
}

/** One member's score window: the 30 days up to `endIso`. */
export interface EngagementWindowRequest {
  memberId: string;
  endIso: string;
}

/** The key of a window in the map `engagementRowsForWindows` returns. */
export const engagementWindowKey = (r: EngagementWindowRequest) => `${r.memberId}|${new Date(r.endIso).toISOString()}`;

/** What a member did in a stretch of time, from their activity log. */
export interface ActivityCounts {
  /** Distinct prickles attended: leaving and rejoining one is one prickle, not two records. */
  pricklesAttended: number;
  /** Slack messages and thread replies (not reactions). */
  slackMessages: number;
}

/** The first time a member did each thing the Hub has a record of, or null. */
export interface ActivityFirsts {
  firstPrickleAt: string | null;
  firstSlackPostAt: string | null;
}

const ID_CHUNK = 100;
const UNIQUE_VIOLATION = "23505";

/**
 * The member activity log: append-only rows other features write as a side effect (a progress entry
 * logged, a commitment made, a lesson watched), and mirrors of other sources (Slack, logins). Reads
 * throw on a database error: a failed read must not look like "no activity".
 */
export interface ActivityRepository {
  /**
   * Appends one activity. False when the log already has it: two sources keep one row per thing
   * (`access_events` per session, `courses` per member, type and related id), so a repeat is a
   * no-op rather than an error. Other database errors throw.
   */
  record(activity: NewActivity): Promise<boolean>;
  /** Appends several in one statement: all or nothing, throws on any error (a duplicate included). Returns how many. */
  recordMany(activities: NewActivity[]): Promise<number>;
  /** Removes the rows a source wrote for one related id (an engagement signal for something that was deleted). */
  removeFor(source: string, relatedId: string): Promise<void>;
  /** Removes the rows a source wrote for any of these related ids, chunked. */
  removeForMany(source: string, relatedIds: string[]): Promise<void>;
  /** Moves every activity of one member to another (a merge). */
  reassign(fromMemberId: string, toMemberId: string): Promise<void>;

  /** How many Slack activities each member has had since this time (ISO), paginated. */
  slackCountsSince(sinceIso: string): Promise<Map<string, number>>;
  /** When the Slack mirror last wrote a row (`created_at`), or null when it never has. */
  lastSlackWriteAt(): Promise<string | null>;
  /** When a member attended each prickle they did (the `prickle_attended` activities). */
  prickleAttendances(memberId: string): Promise<{ member_id: string; occurred_at: string }[]>;
  /** A member's activities since this time (ISO), for their engagement metrics. */
  engagementSince(memberId: string, sinceIso: string): Promise<EngagementRow[]>;
  /** One page of a member's Slack activities, filtered and sorted in the database. `page` is clamped to the pages that exist. */
  slackPage(memberId: string, query: SlackPageQuery): Promise<{ rows: ActivityRow[]; total: number; page: number }>;
  /** The channels a member has Slack activity in, busiest first. */
  slackChannels(memberId: string): Promise<{ name: string; count: number }[]>;
  /** Totals over ALL of a member's Slack activities (not just the feed's latest page); `last30Days` counts those since the given time (ISO). */
  slackSummary(memberId: string, sinceIso: string): Promise<SlackSummary>;
  /** Which of these members have posted a top-level message in this Slack channel (by name). Chunked, paginated. */
  introducedIn(memberIds: string[], channelName: string): Promise<Set<string>>;
  /** Which of these related ids a source has already written. Chunked. */
  relatedIdsWritten(source: string, relatedIds: string[]): Promise<Set<string>>;
  /**
   * What a member did from `fromIso` up to, not including, `toIso`: distinct prickles attended and Slack messages.
   * Paginated past 1000 rows with a stable order. A prickle is counted on the day the member joined it.
   */
  countsBetween(memberId: string, fromIso: string, toIso: string): Promise<ActivityCounts>;
  /** When the activity log first shows a member at a prickle and posting in Slack, whatever the date. */
  firsts(memberId: string): Promise<ActivityFirsts>;
  /**
   * The latest thing each of these members did themselves in the community (`lib/care-participation.ts`: what counts is
   * decided there), as of `now`. Batched: members in chunks, looking back a week, a month, three months, a year and then
   * all time, each step only for the members not found yet, so a busy member costs little and a quiet one is still found.
   * Paginated past 1000 rows. A member with none is absent.
   */
  lastParticipation(memberIds: string[], now: Date): Promise<Map<string, Participation>>;
  /**
   * The activity behind a score, for many windows at once: for each request the member's rows in the 30 days up to its end
   * (both ends included) that carry points (a row worth nothing cannot change a score). Keyed by `engagementWindowKey`.
   * Batched in chunks of windows, paginated past 1000 rows with a stable order.
   */
  engagementRowsForWindows(requests: EngagementWindowRequest[]): Promise<Map<string, EngagementRow[]>>;
}

/** Looking back from now for a member's last participation: days, then all time (null). */
const PARTICIPATION_LOOKBACK_DAYS: (number | null)[] = [7, 30, 90, 365, null];
/** Windows per request for `engagementRowsForWindows` (each becomes one `and(...)` branch of an `or`). */
const WINDOWS_PER_REQUEST = 20;
const DAY_MS = 86_400_000;

const windowStart = (endIso: string) => new Date(Date.parse(endIso) - ENGAGEMENT_WINDOW_DAYS * DAY_MS).toISOString();

/** Hands each request the rows of its member that fall in its window. */
function rowsByWindow(requests: EngagementWindowRequest[], rows: readonly EngagementRow[]): Map<string, EngagementRow[]> {
  const out = new Map<string, EngagementRow[]>();
  for (const request of requests) {
    const from = Date.parse(windowStart(request.endIso));
    const to = Date.parse(request.endIso);
    out.set(
      engagementWindowKey(request),
      rows.filter((r) => r.member_id === request.memberId && Date.parse(r.occurred_at) >= from && Date.parse(r.occurred_at) <= to)
    );
  }
  return out;
}

const SLACK_MESSAGE_TYPES = ["slack_message", "slack_thread_reply"];

type CountRow = { activity_type: string; related_id: string | null; prickle_id: string | null };

/** One distinct prickle per prickle id (the related id of an attendance activity), whatever the number of rows. */
function countRows(rows: CountRow[]): ActivityCounts {
  const prickles = new Set<string>();
  let slackMessages = 0;
  let unkeyed = 0;
  for (const r of rows) {
    if (r.activity_type !== "prickle_attended") slackMessages += 1;
    else if (r.related_id ?? r.prickle_id) prickles.add((r.related_id ?? r.prickle_id) as string);
    else unkeyed += 1; // no prickle to tell it apart by: each counts once
  }
  return { pricklesAttended: prickles.size + unkeyed, slackMessages };
}
// The database column (or JSON path) each sortable column of the Slack tab orders by.
const SLACK_SORT_COLUMN: Record<SlackSortColumn, string> = {
  type: "activity_type",
  channel: "data->>channel_name",
  content: "description",
  date: "occurred_at",
};

/** The two PostgREST filters the Slack page applies (the builders return themselves). */
interface Filterable<T> {
  eq(column: string, value: string): T;
  in(column: string, values: string[]): T;
}

export interface SlackSummary {
  total: number;
  messages: number;
  reactions: number;
  channels: number;
  last30Days: number;
}

type SlackSummaryRow = { activity_type: string; occurred_at: string; channel_name: string | null };

function summarizeSlack(rows: SlackSummaryRow[], sinceIso: string): SlackSummary {
  return {
    total: rows.length,
    messages: rows.filter((r) => r.activity_type === "slack_message" || r.activity_type === "slack_thread_reply").length,
    reactions: rows.filter((r) => r.activity_type === "slack_reaction").length,
    channels: new Set(rows.map((r) => r.channel_name).filter(Boolean)).size,
    last30Days: rows.filter((r) => r.occurred_at >= sinceIso).length,
  };
}

function toInsert(a: NewActivity): Insert<"member_activities"> {
  return {
    member_id: a.memberId,
    activity_type: a.type,
    activity_category: a.category,
    title: a.title,
    occurred_at: a.occurredAt,
    source: a.source,
    related_id: a.relatedId ?? null,
    description: a.description ?? null,
    ...(a.engagementValue === undefined ? {} : { engagement_value: a.engagementValue }),
    ...(a.actorKind === undefined ? {} : { actor_kind: a.actorKind }),
    actor_user_id: a.actorUserId ?? null,
    duration_minutes: a.durationMinutes ?? null,
    prickle_id: a.prickleId ?? null,
    data: a.data ?? null,
  };
}

export class SupabaseActivityRepository implements ActivityRepository {
  constructor(private readonly db: Db) {}

  async record(activity: NewActivity) {
    const { error } = await this.db.from("member_activities").insert(toInsert(activity));
    if (error?.code === UNIQUE_VIOLATION) return false;
    if (error) throw new Error(error.message);
    return true;
  }

  async recordMany(activities: NewActivity[]) {
    if (activities.length === 0) return 0;
    const { error } = await this.db.from("member_activities").insert(activities.map(toInsert));
    if (error) throw new Error(error.message);
    return activities.length;
  }

  async removeFor(source: string, relatedId: string) {
    const { error } = await this.db.from("member_activities").delete().eq("related_id", relatedId).eq("source", source);
    if (error) throw new Error(error.message);
  }

  async removeForMany(source: string, relatedIds: string[]) {
    await inChunks(relatedIds, ID_CHUNK, async (part) => {
      const { error } = await this.db.from("member_activities").delete().eq("source", source).in("related_id", part);
      if (error) throw new Error(error.message);
      return [];
    });
  }

  async reassign(fromMemberId: string, toMemberId: string) {
    const { error } = await this.db.from("member_activities").update({ member_id: toMemberId }).eq("member_id", fromMemberId);
    if (error) throw new Error(error.message);
  }

  async slackCountsSince(sinceIso: string) {
    type Row = { member_id: string };
    const rows = await fetchAllRows<Row>(
      (from, to) =>
        this.db.from("member_activities").select("member_id").eq("source", "slack").gte("occurred_at", sinceIso).order("id").range(from, to)
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.member_id, (counts.get(r.member_id) ?? 0) + 1);
    return counts;
  }

  async lastSlackWriteAt() {
    const { data, error } = await this.db.from("member_activities").select("created_at").eq("source", "slack").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.created_at ?? null;
  }

  async prickleAttendances(memberId: string) {
    type Row = { member_id: string; occurred_at: string };
    return fetchAllRows<Row>(
      (from, to) =>
        this.db.from("member_activities").select("member_id, occurred_at").eq("member_id", memberId).eq("activity_type", "prickle_attended").order("id").range(from, to)
    );
  }

  async engagementSince(memberId: string, sinceIso: string) {
    return fetchAllRows<EngagementRow>(
      (from, to) =>
        this.db.from("member_activities").select("member_id, activity_type, engagement_value, occurred_at").eq("member_id", memberId).gte("occurred_at", sinceIso).order("id").range(from, to)
    );
  }

  async slackPage(memberId: string, query: SlackPageQuery) {
    // Filters shared by the count and the page; the typed client takes plain column names only.
    const filtered = <T extends Filterable<T>>(q: T): T => {
      let out = q.eq("member_id", memberId).eq("source", "slack");
      if (query.kind === "messages") out = out.in("activity_type", SLACK_MESSAGE_TYPES);
      else if (query.kind === "reactions") out = out.eq("activity_type", "slack_reaction");
      if (query.channel) out = out.eq("data->>channel_name", query.channel);
      return out;
    };
    const counted = await filtered(this.db.from("member_activities").select("id", { count: "exact", head: true }));
    if (counted.error) throw new Error(counted.error.message);
    const total = counted.count ?? 0;
    const bounds = pageBounds(query.page, query.pageSize, total);
    if (total === 0) return { rows: [], total, page: bounds.page };
    const ascending = query.sort.direction === "asc";
    const { data, error } = await filtered(this.db.from("member_activities").select("*"))
      .order(SLACK_SORT_COLUMN[query.sort.column], { ascending })
      .order("id", { ascending })
      .range(bounds.offset, bounds.offset + bounds.pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: data ?? [], total, page: bounds.page };
  }

  async slackChannels(memberId: string) {
    const { data, error } = await this.db.rpc("member_slack_channels", { p_member_id: memberId });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ name: r.channel_name, count: r.n }));
  }

  async slackSummary(memberId: string, sinceIso: string) {
    const { data, error } = await this.db.rpc("member_slack_summary", { p_member_id: memberId, p_since: sinceIso });
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return {
      total: row?.total ?? 0,
      messages: row?.messages ?? 0,
      reactions: row?.reactions ?? 0,
      channels: row?.channels ?? 0,
      last30Days: row?.last_30_days ?? 0,
    };
  }

  async introducedIn(memberIds: string[], channelName: string) {
    type Row = { member_id: string };
    const introduced = new Set<string>();
    for (const ids of chunk(memberIds, ID_CHUNK)) {
      const rows = await fetchAllRows<Row>(
        (from, to) =>
          this.db
            .from("member_activities")
            .select("member_id")
            .in("member_id", ids)
            .eq("source", "slack")
            .eq("activity_type", "slack_message")
            .filter("data->>channel_name", "eq", channelName)
            .order("id")
            .range(from, to)
      );
      for (const r of rows) introduced.add(r.member_id);
    }
    return introduced;
  }

  async countsBetween(memberId: string, fromIso: string, toIso: string) {
    const rows = await fetchAllRows<CountRow>((from, to) =>
      this.db
        .from("member_activities")
        .select("activity_type, related_id, prickle_id")
        .eq("member_id", memberId)
        .in("activity_type", ["prickle_attended", ...SLACK_MESSAGE_TYPES])
        .gte("occurred_at", fromIso)
        .lt("occurred_at", toIso)
        .order("id")
        .range(from, to)
    );
    return countRows(rows);
  }

  async firsts(memberId: string) {
    const first = async (types: string[]) => {
      const { data, error } = await this.db
        .from("member_activities")
        .select("occurred_at")
        .eq("member_id", memberId)
        .in("activity_type", types)
        .order("occurred_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.occurred_at ?? null;
    };
    const [firstPrickleAt, firstSlackPostAt] = await Promise.all([first(["prickle_attended"]), first(SLACK_MESSAGE_TYPES)]);
    return { firstPrickleAt, firstSlackPostAt };
  }

  async lastParticipation(memberIds: string[], now: Date) {
    type Row = { member_id: string; activity_type: string; actor_kind: string; occurred_at: string };
    const found = new Map<string, Participation>();
    let pending = [...new Set(memberIds)];
    for (const days of PARTICIPATION_LOOKBACK_DAYS) {
      if (pending.length === 0) break;
      const since = days === null ? null : new Date(now.getTime() - days * DAY_MS).toISOString();
      for (const ids of chunk(pending, ID_CHUNK)) {
        const rows = await fetchAllRows<Row>((from, to) => {
          const query = this.db
            .from("member_activities")
            .select("member_id, activity_type, actor_kind, occurred_at")
            .in("member_id", ids)
            .eq("actor_kind", "member")
            .in("activity_type", [...PARTICIPATION_TYPES])
            .lte("occurred_at", now.toISOString());
          return (since === null ? query : query.gte("occurred_at", since)).order("id").range(from, to);
        });
        for (const [memberId, hit] of latestParticipation(rows)) found.set(memberId, hit);
      }
      pending = pending.filter((id) => !found.has(id));
    }
    return found;
  }

  async engagementRowsForWindows(requests: EngagementWindowRequest[]) {
    const unique = [...new Map(requests.map((r) => [engagementWindowKey(r), r])).values()];
    const out = new Map<string, EngagementRow[]>();
    for (const part of chunk(unique, WINDOWS_PER_REQUEST)) {
      const ranges = part.map((r) => `and(occurred_at.gte.${windowStart(r.endIso)},occurred_at.lte.${new Date(r.endIso).toISOString()})`).join(",");
      const rows = await fetchAllRows<EngagementRow>((from, to) =>
        this.db
          .from("member_activities")
          .select("member_id, activity_type, engagement_value, occurred_at")
          .in("member_id", [...new Set(part.map((r) => r.memberId))])
          .neq("engagement_value", 0)
          .or(ranges)
          .order("id")
          .range(from, to)
      );
      for (const [key, list] of rowsByWindow(part, rows)) out.set(key, list);
    }
    return out;
  }

  async relatedIdsWritten(source: string, relatedIds: string[]) {
    const written = new Set<string>();
    for (const ids of chunk(relatedIds, ID_CHUNK)) {
      const { data, error } = await this.db.from("member_activities").select("related_id").eq("source", source).in("related_id", ids);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (r.related_id) written.add(r.related_id);
    }
    return written;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryActivityRepository implements ActivityRepository {
  constructor(private readonly data: InMemoryDataset) {}

  /** The two partial unique indexes the log has: one row per login session, one per member, type and related id for courses. */
  private isDuplicate(a: NewActivity, extra: NewActivity[] = []) {
    const same = (x: { source: string; member_id?: string; memberId?: string; activity_type?: string; type?: string; related_id?: string | null; relatedId?: string | null }) => {
      const related = x.related_id ?? x.relatedId ?? null;
      if (a.source === "access_events") return x.source === "access_events" && related === (a.relatedId ?? null);
      if (a.source === "courses") {
        return x.source === "courses" && (x.member_id ?? x.memberId) === a.memberId && (x.activity_type ?? x.type) === a.type && related === (a.relatedId ?? null);
      }
      return false;
    };
    return this.data.activities.some(same) || extra.some(same);
  }

  private store(a: NewActivity) {
    this.data.activities.push({
      id: `act_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: a.memberId,
      activity_type: a.type,
      activity_category: a.category,
      title: a.title,
      occurred_at: a.occurredAt,
      source: a.source,
      related_id: a.relatedId ?? null,
      description: a.description ?? null,
      engagement_value: a.engagementValue ?? null,
      actor_kind: a.actorKind ?? "member",
      actor_user_id: a.actorUserId ?? null,
      acting_as_member_id: null,
      duration_minutes: a.durationMinutes ?? null,
      prickle_id: a.prickleId ?? null,
      data: a.data ?? null,
      // Strictly after every earlier row, like the database's clock.
      created_at: new Date(Math.max(Date.now(), ...this.data.activities.map((r) => (r.created_at ? Date.parse(r.created_at) + 1 : 0)))).toISOString(),
    });
  }

  async record(activity: NewActivity) {
    if (this.isDuplicate(activity)) return false;
    this.store(activity);
    return true;
  }

  async recordMany(activities: NewActivity[]) {
    const seen: NewActivity[] = [];
    for (const a of activities) {
      if (this.isDuplicate(a, seen)) throw new Error("duplicate key value violates unique constraint");
      seen.push(a);
    }
    for (const a of activities) this.store(a);
    return activities.length;
  }

  async removeFor(source: string, relatedId: string) {
    this.data.activities = this.data.activities.filter((a) => !(a.source === source && a.related_id === relatedId));
  }

  async removeForMany(source: string, relatedIds: string[]) {
    const ids = new Set(relatedIds);
    this.data.activities = this.data.activities.filter((a) => !(a.source === source && a.related_id !== null && ids.has(a.related_id)));
  }

  async reassign(fromMemberId: string, toMemberId: string) {
    for (const a of this.data.activities) if (a.member_id === fromMemberId) a.member_id = toMemberId;
  }

  async slackCountsSince(sinceIso: string) {
    const counts = new Map<string, number>();
    for (const a of this.data.activities) {
      if (a.source === "slack" && a.occurred_at >= sinceIso) counts.set(a.member_id, (counts.get(a.member_id) ?? 0) + 1);
    }
    return counts;
  }

  async lastSlackWriteAt() {
    const times = this.data.activities.filter((a) => a.source === "slack" && a.created_at).map((a) => a.created_at as string);
    return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }

  async prickleAttendances(memberId: string) {
    return this.data.activities.filter((a) => a.member_id === memberId && a.activity_type === "prickle_attended").map((a) => ({ member_id: a.member_id, occurred_at: a.occurred_at }));
  }

  async engagementSince(memberId: string, sinceIso: string) {
    return this.data.activities
      .filter((a) => a.member_id === memberId && a.occurred_at >= sinceIso)
      .map((a) => ({ member_id: a.member_id, activity_type: a.activity_type, engagement_value: a.engagement_value, occurred_at: a.occurred_at }));
  }

  async slackPage(memberId: string, query: SlackPageQuery) {
    const channelOf = (a: ActivityRow) => (a.data as { channel_name?: string } | null)?.channel_name ?? null;
    const sortValue = (a: ActivityRow): string | null =>
      ({ type: a.activity_type, channel: channelOf(a), content: a.description, date: a.occurred_at })[query.sort.column];
    const sign = query.sort.direction === "asc" ? 1 : -1;
    const rows = this.data.activities
      .filter((a) => a.member_id === memberId && a.source === "slack")
      .filter((a) => query.kind === "all" || (query.kind === "messages" ? SLACK_MESSAGE_TYPES.includes(a.activity_type) : a.activity_type === "slack_reaction"))
      .filter((a) => !query.channel || channelOf(a) === query.channel)
      .sort((a, b) => {
        const x = sortValue(a);
        const y = sortValue(b);
        // Postgres: nulls sort last ascending, first descending.
        const byValue = x === y ? 0 : x === null ? sign : y === null ? -sign : x < y ? -sign : sign;
        return byValue || (a.id < b.id ? -sign : a.id > b.id ? sign : 0);
      });
    const bounds = pageBounds(query.page, query.pageSize, rows.length);
    return { rows: rows.slice(bounds.offset, bounds.offset + bounds.pageSize).map((a) => ({ ...a })), total: rows.length, page: bounds.page };
  }

  async slackChannels(memberId: string) {
    const counts = new Map<string, number>();
    for (const a of this.data.activities) {
      const name = (a.data as { channel_name?: string } | null)?.channel_name;
      if (a.member_id === memberId && a.source === "slack" && name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  }

  async slackSummary(memberId: string, sinceIso: string) {
    return summarizeSlack(
      this.data.activities
        .filter((a) => a.member_id === memberId && a.source === "slack")
        .map((a) => ({ activity_type: a.activity_type, occurred_at: a.occurred_at, channel_name: (a.data as { channel_name?: string } | null)?.channel_name ?? null })),
      sinceIso
    );
  }

  async introducedIn(memberIds: string[], channelName: string) {
    const wanted = new Set(memberIds);
    return new Set(
      this.data.activities
        .filter((a) => wanted.has(a.member_id) && a.source === "slack" && a.activity_type === "slack_message" && (a.data as { channel_name?: string } | null)?.channel_name === channelName)
        .map((a) => a.member_id)
    );
  }

  async countsBetween(memberId: string, fromIso: string, toIso: string) {
    const types = ["prickle_attended", ...SLACK_MESSAGE_TYPES];
    return countRows(
      this.data.activities.filter((a) => a.member_id === memberId && types.includes(a.activity_type) && Date.parse(a.occurred_at) >= Date.parse(fromIso) && Date.parse(a.occurred_at) < Date.parse(toIso))
    );
  }

  async firsts(memberId: string) {
    const first = (types: string[]) => {
      const times = this.data.activities.filter((a) => a.member_id === memberId && types.includes(a.activity_type)).map((a) => a.occurred_at);
      return times.length ? times.reduce((a, b) => (new Date(b) < new Date(a) ? b : a)) : null;
    };
    return { firstPrickleAt: first(["prickle_attended"]), firstSlackPostAt: first(SLACK_MESSAGE_TYPES) };
  }

  async lastParticipation(memberIds: string[], now: Date) {
    const wanted = new Set(memberIds);
    return latestParticipation(this.data.activities.filter((a) => wanted.has(a.member_id) && Date.parse(a.occurred_at) <= now.getTime()));
  }

  async engagementRowsForWindows(requests: EngagementWindowRequest[]) {
    const rows = this.data.activities
      .filter((a) => a.engagement_value !== null && a.engagement_value !== 0)
      .map((a) => ({ member_id: a.member_id, activity_type: a.activity_type, engagement_value: a.engagement_value, occurred_at: a.occurred_at }));
    return rowsByWindow(requests, rows);
  }

  async relatedIdsWritten(source: string, relatedIds: string[]) {
    const wanted = new Set(relatedIds);
    return new Set(this.data.activities.filter((a) => a.source === source && a.related_id && wanted.has(a.related_id)).map((a) => a.related_id as string));
  }
}
