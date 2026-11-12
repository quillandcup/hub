import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * A 1:1 Slack DM a staff member chose to track for Hedgie Care: who tracks it, the Slack conversation, and the member
 * on the other side. Never any message content.
 */
export type TrackedDm = {
  id: string;
  /** The staff member's auth user id. */
  trackedBy: string;
  /** The Slack DM conversation id (from Slack, external). */
  channelId: string;
  /** The Hub member on the other side. */
  memberId: string;
  createdAt: string;
};

/** Tracking answers with the row, and whether this call made it (false: it was already tracked). */
export type TrackResult = { created: boolean; dm: TrackedDm };

/**
 * The DMs staff track for Hedgie Care (`care_tracked_dms`, docs/HEDGIE_CARE.md, "Slack DMs fill it in"): opt-in per DM, a
 * staff member's private working list. With a signed-in client row-level security lets each staff user read and change
 * only their own rows (an admin does not see another's); `allLive` and `forChannel` are for the projection and need the
 * service role to see everyone's. Untracking is a soft delete (`deleted_at`) and every read leaves deleted ones out.
 * Methods throw on a database error.
 */
export interface CareTrackedDmRepository {
  /** One staff member's live tracked DMs, oldest tracked first. */
  forUser(userId: string): Promise<TrackedDm[]>;
  /** Every live tracked DM of every staff member (service role), by user then channel. Paginated. */
  allLive(): Promise<TrackedDm[]>;
  /** Every staff member's live tracking of DMs with this member (service role), by user then channel: whose DMs hold the messages of the member's care plans. */
  forMember(memberId: string): Promise<TrackedDm[]>;
  /** Every staff member's live tracking of this Slack DM (service role), by user. */
  forChannel(channelId: string): Promise<TrackedDm[]>;
  /**
   * The Slack DMs each of these staff users stopped tracking and has not tracked again: the choices to respect, so nothing
   * tracks one of them for her again on its own. By user id; a user with none has no entry. Read with the service role for
   * several users (a signed-in client sees only its own rows).
   */
  untrackedChannels(userIds: readonly string[]): Promise<Map<string, Set<string>>>;
  /** Starts tracking a DM as `trackedBy`. Tracking one already tracked is not an error: it answers the existing row with `created: false`. */
  track(input: { trackedBy: string; channelId: string; memberId: string }): Promise<TrackResult>;
  /** Stops tracking a DM at `at` (the row is kept). False when it was not tracked. */
  untrack(userId: string, channelId: string, at: string): Promise<boolean>;
}

const UNIQUE_VIOLATION = "23505";

function toDm(row: Row<"care_tracked_dms">): TrackedDm {
  return { id: row.id, trackedBy: row.tracked_by, channelId: row.slack_channel_id, memberId: row.member_id, createdAt: row.created_at };
}

export class SupabaseCareTrackedDmRepository implements CareTrackedDmRepository {
  constructor(private readonly db: Db) {}

  async forUser(userId: string) {
    const rows = await fetchAllRows<Row<"care_tracked_dms">>((from, to) =>
      this.db.from("care_tracked_dms").select("*").eq("tracked_by", userId).is("deleted_at", null).order("created_at").order("id").range(from, to)
    );
    return rows.map(toDm);
  }

  async allLive() {
    const rows = await fetchAllRows<Row<"care_tracked_dms">>((from, to) =>
      this.db.from("care_tracked_dms").select("*").is("deleted_at", null).order("tracked_by").order("slack_channel_id").order("id").range(from, to)
    );
    return rows.map(toDm);
  }

  async forMember(memberId: string) {
    const rows = await fetchAllRows<Row<"care_tracked_dms">>((from, to) =>
      this.db.from("care_tracked_dms").select("*").eq("member_id", memberId).is("deleted_at", null).order("tracked_by").order("slack_channel_id").order("id").range(from, to)
    );
    return rows.map(toDm);
  }

  async forChannel(channelId: string) {
    const rows = await fetchAllRows<Row<"care_tracked_dms">>((from, to) =>
      this.db.from("care_tracked_dms").select("*").eq("slack_channel_id", channelId).is("deleted_at", null).order("tracked_by").order("id").range(from, to)
    );
    return rows.map(toDm);
  }

  async untrackedChannels(userIds: readonly string[]) {
    const out = new Map<string, Set<string>>();
    if (userIds.length === 0) return out;
    const rows = await fetchAllRows<Pick<Row<"care_tracked_dms">, "tracked_by" | "slack_channel_id" | "deleted_at">>((from, to) =>
      this.db
        .from("care_tracked_dms")
        .select("tracked_by, slack_channel_id, deleted_at")
        .in("tracked_by", [...userIds])
        .order("tracked_by")
        .order("slack_channel_id")
        .order("id")
        .range(from, to)
    );
    return untrackedFrom(rows);
  }

  async track(input: { trackedBy: string; channelId: string; memberId: string }): Promise<TrackResult> {
    const { data, error } = await this.db
      .from("care_tracked_dms")
      .insert({ tracked_by: input.trackedBy, slack_channel_id: input.channelId, member_id: input.memberId })
      .select("*")
      .single();
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing, error: lookupError } = await this.db
        .from("care_tracked_dms")
        .select("*")
        .eq("tracked_by", input.trackedBy)
        .eq("slack_channel_id", input.channelId)
        .is("deleted_at", null)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      // Untracked between the two statements: not a case worth a result of its own.
      if (!existing) throw new Error(error.message);
      return { created: false, dm: toDm(existing) };
    }
    if (error) throw new Error(error.message);
    return { created: true, dm: toDm(data) };
  }

  async untrack(userId: string, channelId: string, at: string) {
    const { data, error } = await this.db
      .from("care_tracked_dms")
      .update({ deleted_at: at })
      .eq("tracked_by", userId)
      .eq("slack_channel_id", channelId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }
}

/** The channels with a deleted row and no live one, by user: every row of these users in, the answer out (shared by both implementations). */
function untrackedFrom(rows: readonly Pick<Row<"care_tracked_dms">, "tracked_by" | "slack_channel_id" | "deleted_at">[]): Map<string, Set<string>> {
  const live = new Set(rows.filter((r) => r.deleted_at === null).map((r) => `${r.tracked_by}|${r.slack_channel_id}`));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.deleted_at === null || live.has(`${r.tracked_by}|${r.slack_channel_id}`)) continue;
    const set = out.get(r.tracked_by) ?? new Set<string>();
    set.add(r.slack_channel_id);
    out.set(r.tracked_by, set);
  }
  return out;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** `caredm_` and 12 base58 characters from a counter, so the twin's ids look like the database's. */
function twinId(n: number): string {
  let rest = n;
  let out = "";
  for (let i = 0; i < 12; i++) {
    out = BASE58[rest % BASE58.length] + out;
    rest = Math.floor(rest / BASE58.length);
  }
  return `caredm_${out}`;
}

/** In-memory twin over an `InMemoryDataset`, enforcing the constraints the database does (members exist, one live row per user and channel). */
export class InMemoryCareTrackedDmRepository implements CareTrackedDmRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.careTrackedDms.filter((r) => r.deleted_at === null);
  }

  async forUser(userId: string) {
    return this.live()
      .filter((r) => r.tracked_by === userId)
      .sort(byKeyThenId<Row<"care_tracked_dms">>((r) => r.created_at, (r) => r.id))
      .map(toDm);
  }

  async allLive() {
    return this.live()
      .sort(byKeyThenId<Row<"care_tracked_dms">>((r) => `${r.tracked_by}|${r.slack_channel_id}`, (r) => r.id))
      .map(toDm);
  }

  async forMember(memberId: string) {
    return this.live()
      .filter((r) => r.member_id === memberId)
      .sort(byKeyThenId<Row<"care_tracked_dms">>((r) => `${r.tracked_by}|${r.slack_channel_id}`, (r) => r.id))
      .map(toDm);
  }

  async forChannel(channelId: string) {
    return this.live()
      .filter((r) => r.slack_channel_id === channelId)
      .sort(byKeyThenId<Row<"care_tracked_dms">>((r) => r.tracked_by, (r) => r.id))
      .map(toDm);
  }

  async untrackedChannels(userIds: readonly string[]) {
    return untrackedFrom(this.data.careTrackedDms.filter((r) => userIds.includes(r.tracked_by)));
  }

  async track(input: { trackedBy: string; channelId: string; memberId: string }): Promise<TrackResult> {
    if (input.channelId === "") throw new Error("violates check constraint on slack_channel_id");
    if (!this.data.members.some((m) => m.id === input.memberId)) throw new Error("violates foreign key constraint on member_id");
    const existing = this.live().find((r) => r.tracked_by === input.trackedBy && r.slack_channel_id === input.channelId);
    if (existing) return { created: false, dm: toDm(existing) };
    const row: Row<"care_tracked_dms"> = {
      id: twinId(this.data.careTrackedDms.length + 1),
      tracked_by: input.trackedBy,
      slack_channel_id: input.channelId,
      member_id: input.memberId,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    this.data.careTrackedDms.push(row);
    return { created: true, dm: toDm(row) };
  }

  async untrack(userId: string, channelId: string, at: string) {
    const row = this.live().find((r) => r.tracked_by === userId && r.slack_channel_id === channelId);
    if (!row) return false;
    row.deleted_at = at;
    return true;
  }
}
