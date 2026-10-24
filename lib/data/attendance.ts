import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";

/** Ids per `.in(...)` filter, so the request URL stays well under PostgREST's length limit. */
const ID_CHUNK_SIZE = 500;

/** One member attended one prickle (a member can have several attendance records per prickle). */
export type AttendanceLink = { memberId: string; prickleId: string };

/** An attendance record as stored: one join and leave. Leave and rejoin makes several per prickle. */
export type AttendanceRow = {
  id: string;
  memberId: string;
  prickleId: string;
  joinTime: string;
  leaveTime: string;
};

/**
 * Everything the app asks of `prickle_attendance`. Records per (member, prickle) are NOT unique
 * (CLAUDE.md, "Attendance Table Design"), so "who attended" is always distinct and "how many
 * prickles" never counts records; that rule lives here once, not in each caller.
 */
export interface AttendanceRepository {
  /** Number of attendance records for the member (records, not distinct prickles). */
  countForMember(memberId: string): Promise<number>;
  /** Distinct prickles the member attended. */
  attendedPrickleIds(memberId: string): Promise<Set<string>>;
  /** Distinct prickles attended, for every member who attended any. */
  attendedPrickleIdsByMember(): Promise<Map<string, Set<string>>>;
  /** Who attended these prickles, one entry per record. */
  forPrickles(prickleIds: string[]): Promise<AttendanceLink[]>;
  /** Which of these members attended at least one prickle. */
  membersWhoAttended(memberIds: string[]): Promise<Set<string>>;
  /** When each of these members last joined a prickle; members who never did are absent. */
  lastJoinByMember(memberIds: string[]): Promise<Map<string, Date>>;
  /** The member's earliest join time (ISO), or null if they never attended. */
  firstJoinTime(memberId: string): Promise<string | null>;
  /** Move every record from one member to another (merging duplicate members). */
  reassign(fromMemberId: string, toMemberId: string): Promise<void>;
}

export class SupabaseAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Db) {}

  async countForMember(memberId: string): Promise<number> {
    const { count, error } = await this.db
      .from("prickle_attendance")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async attendedPrickleIds(memberId: string): Promise<Set<string>> {
    const rows = await fetchAllRows((from, to) =>
      this.db.from("prickle_attendance").select("prickle_id").eq("member_id", memberId).order("id").range(from, to),
    );
    return new Set(rows.map((row) => row.prickle_id));
  }

  async attendedPrickleIdsByMember(): Promise<Map<string, Set<string>>> {
    const rows = await fetchAllRows((from, to) =>
      this.db.from("prickle_attendance").select("member_id, prickle_id").order("id").range(from, to),
    );
    const byMember = new Map<string, Set<string>>();
    for (const row of rows) {
      const prickleIds = byMember.get(row.member_id) ?? new Set<string>();
      prickleIds.add(row.prickle_id);
      byMember.set(row.member_id, prickleIds);
    }
    return byMember;
  }

  async forPrickles(prickleIds: string[]): Promise<AttendanceLink[]> {
    const links: AttendanceLink[] = [];
    for (const ids of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows((from, to) =>
        this.db.from("prickle_attendance").select("prickle_id, member_id").in("prickle_id", ids).order("id").range(from, to),
      );
      for (const row of rows) links.push({ memberId: row.member_id, prickleId: row.prickle_id });
    }
    return links;
  }

  async membersWhoAttended(memberIds: string[]): Promise<Set<string>> {
    const attended = new Set<string>();
    for (const ids of chunk(memberIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows((from, to) =>
        this.db.from("prickle_attendance").select("member_id").in("member_id", ids).order("id").range(from, to),
      );
      for (const row of rows) attended.add(row.member_id);
    }
    return attended;
  }

  async lastJoinByMember(memberIds: string[]): Promise<Map<string, Date>> {
    const last = new Map<string, Date>();
    for (const ids of chunk(memberIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows((from, to) =>
        this.db.from("prickle_attendance").select("member_id, join_time").in("member_id", ids).order("id").range(from, to),
      );
      for (const row of rows) {
        const joined = new Date(row.join_time);
        const seen = last.get(row.member_id);
        if (!seen || joined > seen) last.set(row.member_id, joined);
      }
    }
    return last;
  }

  async firstJoinTime(memberId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("prickle_attendance")
      .select("join_time")
      .eq("member_id", memberId)
      .order("join_time", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.join_time ?? null;
  }

  async reassign(fromMemberId: string, toMemberId: string): Promise<void> {
    const { error } = await this.db.from("prickle_attendance").update({ member_id: toMemberId }).eq("member_id", fromMemberId);
    if (error) throw new Error(error.message);
  }
}

/**
 * In-memory twin for tests, demos and seed profiles. Same rules as the Supabase one (distinct
 * prickles, several records per prickle allowed); seed it with typed `AttendanceRow`s.
 */
export class InMemoryAttendanceRepository implements AttendanceRepository {
  private rows: AttendanceRow[];

  constructor(rows: AttendanceRow[] = []) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  async countForMember(memberId: string) {
    return this.rows.filter((row) => row.memberId === memberId).length;
  }

  async attendedPrickleIds(memberId: string) {
    return new Set(this.rows.filter((row) => row.memberId === memberId).map((row) => row.prickleId));
  }

  async attendedPrickleIdsByMember() {
    const byMember = new Map<string, Set<string>>();
    for (const row of this.rows) {
      const prickleIds = byMember.get(row.memberId) ?? new Set<string>();
      prickleIds.add(row.prickleId);
      byMember.set(row.memberId, prickleIds);
    }
    return byMember;
  }

  async forPrickles(prickleIds: string[]) {
    const wanted = new Set(prickleIds);
    return this.rows
      .filter((row) => wanted.has(row.prickleId))
      .map((row) => ({ memberId: row.memberId, prickleId: row.prickleId }));
  }

  async membersWhoAttended(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return new Set(this.rows.filter((row) => wanted.has(row.memberId)).map((row) => row.memberId));
  }

  async lastJoinByMember(memberIds: string[]) {
    const wanted = new Set(memberIds);
    const last = new Map<string, Date>();
    for (const row of this.rows) {
      if (!wanted.has(row.memberId)) continue;
      const joined = new Date(row.joinTime);
      const seen = last.get(row.memberId);
      if (!seen || joined > seen) last.set(row.memberId, joined);
    }
    return last;
  }

  async firstJoinTime(memberId: string) {
    const times = this.rows.filter((row) => row.memberId === memberId).map((row) => row.joinTime);
    if (times.length === 0) return null;
    return times.reduce((earliest, time) => (new Date(time) < new Date(earliest) ? time : earliest));
  }

  async reassign(fromMemberId: string, toMemberId: string) {
    for (const row of this.rows) if (row.memberId === fromMemberId) row.memberId = toMemberId;
  }
}
