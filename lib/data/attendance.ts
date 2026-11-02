import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import { InMemoryDataset } from "./in-memory";
import { inChunks } from "./query";
import { one, prickleDetail, prickleEmbed, toDetail, type DetailRow, type PrickleDetail } from "./prickles";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit even with long ids. */
const ID_CHUNK_SIZE = 100;

/** One attendance record: a member joined a prickle (a member can have several records per prickle). */
export type AttendanceLink = { memberId: string; prickleId: string; joinTime: string };

/** When a member was in a prickle, one join and leave; no prickle, for time-based reports. */
export type AttendanceSpan = { memberId: string; joinTime: string; leaveTime: string };

/** An attendance record as stored: one join and leave. Leave and rejoin makes several per prickle. */
export type AttendanceRow = {
  id: string;
  memberId: string;
  prickleId: string;
  joinTime: string;
  leaveTime: string;
  /** "high" when not given. */
  confidenceScore?: string;
};

/** An attendance record with the prickle it was at, joined in with its type and host. */
export type AttendedPrickle = {
  id: string;
  prickleId: string;
  joinTime: string;
  leaveTime: string;
  confidenceScore: string;
  /** Null only if the prickle is hidden from the caller. */
  prickle: PrickleDetail | null;
};

/** An attendance record with who attended. `email` is only filled for admin reads, otherwise null. */
export type Attendee = {
  id: string;
  memberId: string;
  prickleId: string;
  joinTime: string;
  leaveTime: string;
  confidenceScore: string;
  /** Null if the member's directory entry is hidden from the caller. */
  name: string | null;
  displayName: string | null;
  email: string | null;
};

/** Narrow a member's attendance to the records at certain prickles. */
export type MemberAttendanceFilter = {
  /** Only prickles whose type has this purpose, e.g. "writing". */
  purpose?: string;
  /** Only prickles that started at or after this instant (ISO). */
  prickleStartedSince?: string;
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
  /** Every attendance record in the table. Large: for community-wide scans only. */
  list(): Promise<AttendanceLink[]>;
  /** Who attended these prickles, one entry per record. */
  forPrickles(prickleIds: string[]): Promise<AttendanceLink[]>;
  /** Which of these prickles anyone attended. */
  prickleIdsWithAttendance(prickleIds: string[]): Promise<Set<string>>;
  /** Which of these prickles the member attended. */
  attendedAmong(memberId: string, prickleIds: string[]): Promise<Set<string>>;
  /** For each of these prickles the member attended, when they first joined it (ISO). */
  earliestJoinByPrickle(memberId: string, prickleIds: string[]): Promise<Map<string, string>>;
  /** Records that began between the two instants (ISO, inclusive), for every member. */
  joinedBetween(from: string, to: string): Promise<AttendanceSpan[]>;
  /** Which of these members attended at least one prickle. */
  membersWhoAttended(memberIds: string[]): Promise<Set<string>>;
  /** When each of these members last joined a prickle; members who never did are absent. */
  lastJoinByMember(memberIds: string[]): Promise<Map<string, Date>>;
  /** The member's earliest join time (ISO), or null if they never attended. */
  firstJoinTime(memberId: string): Promise<string | null>;
  /** The member's most recent join, optionally only those at or before `before` (ISO); null if none. */
  lastJoinTime(memberId: string, options?: { before?: string }): Promise<string | null>;
  /** The member's records, newest join first, each with its prickle (type and host joined in). */
  forMemberWithPrickles(memberId: string, filter?: MemberAttendanceFilter): Promise<AttendedPrickle[]>;
  /**
   * Everyone who attended the prickle, earliest join first. `includeEmail` is for admins: it reads
   * the members table; otherwise names come from the public member directory and `email` is null.
   */
  attendeesOf(prickleId: string, options?: { includeEmail?: boolean }): Promise<Attendee[]>;
  /** Other members' records at these prickles (never the member's own), with their public names. */
  coAttendees(memberId: string, prickleIds: string[]): Promise<Attendee[]>;
  /** Records that began between the two instants (ISO, inclusive), with the attendee's public name. */
  attendeesJoinedBetween(from: string, to: string): Promise<Attendee[]>;
  /** Move every record from one member to another (merging duplicate members). */
  reassign(fromMemberId: string, toMemberId: string): Promise<void>;
}

type AttendedRow = {
  id: string;
  prickle_id: string;
  join_time: string;
  leave_time: string;
  confidence_score: string;
  prickles: DetailRow | DetailRow[] | null;
};
type AttendeeRow = {
  id: string;
  member_id: string;
  prickle_id: string;
  join_time: string;
  leave_time: string;
  confidence_score: string;
  attendee: AttendeeMember | AttendeeMember[] | null;
};
type AttendeeMember = { id: string; name: string; display_name: string | null; email?: string | null };

const ATTENDEE_COLUMNS = "id, member_id, prickle_id, join_time, leave_time, confidence_score";
// Admins read the members table (email included); everyone else gets names from the public member
// directory through the `attendance_member` relationship, which has no email to leak.
const attendeeEmbed = (includeEmail: boolean, inner: boolean) =>
  includeEmail
    ? `attendee:members${inner ? "!inner" : ""}(id, name, display_name, email)`
    : `attendee:attendance_member${inner ? "!inner" : ""}(id, name, display_name)`;

function toAttendee(row: AttendeeRow): Attendee {
  const member = one(row.attendee);
  return {
    id: row.id,
    memberId: row.member_id,
    prickleId: row.prickle_id,
    joinTime: row.join_time,
    leaveTime: row.leave_time,
    confidenceScore: row.confidence_score,
    name: member?.name ?? null,
    displayName: member?.display_name ?? null,
    email: member?.email ?? null,
  };
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

  async list(): Promise<AttendanceLink[]> {
    const rows = await fetchAllRows((from, to) =>
      this.db.from("prickle_attendance").select("prickle_id, member_id, join_time").order("id").range(from, to),
    );
    return rows.map((row) => ({ memberId: row.member_id, prickleId: row.prickle_id, joinTime: row.join_time }));
  }

  async forPrickles(prickleIds: string[]): Promise<AttendanceLink[]> {
    return inChunks(prickleIds, ID_CHUNK_SIZE, async (ids) => {
      const rows = await fetchAllRows((from, to) =>
        this.db
          .from("prickle_attendance")
          .select("prickle_id, member_id, join_time")
          .in("prickle_id", ids)
          .order("id")
          .range(from, to),
      );
      return rows.map((row) => ({ memberId: row.member_id, prickleId: row.prickle_id, joinTime: row.join_time }));
    });
  }

  async prickleIdsWithAttendance(prickleIds: string[]): Promise<Set<string>> {
    const attended = new Set<string>();
    for (const ids of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows((from, to) =>
        this.db.from("prickle_attendance").select("prickle_id").in("prickle_id", ids).order("id").range(from, to),
      );
      for (const row of rows) attended.add(row.prickle_id);
    }
    return attended;
  }

  async attendedAmong(memberId: string, prickleIds: string[]): Promise<Set<string>> {
    return new Set((await this.earliestJoinByPrickle(memberId, prickleIds)).keys());
  }

  async earliestJoinByPrickle(memberId: string, prickleIds: string[]): Promise<Map<string, string>> {
    const earliest = new Map<string, string>();
    for (const ids of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows((from, to) =>
        this.db
          .from("prickle_attendance")
          .select("prickle_id, join_time")
          .eq("member_id", memberId)
          .in("prickle_id", ids)
          .order("id")
          .range(from, to),
      );
      for (const row of rows) {
        const seen = earliest.get(row.prickle_id);
        if (!seen || new Date(row.join_time) < new Date(seen)) earliest.set(row.prickle_id, row.join_time);
      }
    }
    return earliest;
  }

  async joinedBetween(from: string, to: string): Promise<AttendanceSpan[]> {
    const rows = await fetchAllRows((start, end) =>
      this.db
        .from("prickle_attendance")
        .select("member_id, join_time, leave_time")
        .gte("join_time", from)
        .lte("join_time", to)
        .order("id")
        .range(start, end),
    );
    return rows.map((row) => ({ memberId: row.member_id, joinTime: row.join_time, leaveTime: row.leave_time }));
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

  async lastJoinTime(memberId: string, { before }: { before?: string } = {}): Promise<string | null> {
    let query = this.db.from("prickle_attendance").select("join_time").eq("member_id", memberId);
    if (before) query = query.lte("join_time", before);
    const { data, error } = await query.order("join_time", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.join_time ?? null;
  }

  async forMemberWithPrickles(memberId: string, { purpose, prickleStartedSince }: MemberAttendanceFilter = {}): Promise<AttendedPrickle[]> {
    const inner = purpose !== undefined || prickleStartedSince !== undefined;
    const rows = await fetchAllRows<AttendedRow>((from, to) => {
      let query = this.db
        .from("prickle_attendance")
        .select(`id, prickle_id, join_time, leave_time, confidence_score, ${prickleEmbed(inner)}`)
        .eq("member_id", memberId);
      if (purpose !== undefined) query = query.eq("prickles.prickle_type.purpose", purpose);
      if (prickleStartedSince !== undefined) query = query.gte("prickles.start_time", prickleStartedSince);
      // The select string is built at runtime (the embed varies), so PostgREST can't type it: rows typed by hand.
      return query.order("join_time", { ascending: false }).order("id").range(from, to).overrideTypes<AttendedRow[], { merge: false }>();
    });
    return rows.map((row) => {
      const prickle = one(row.prickles);
      return {
        id: row.id,
        prickleId: row.prickle_id,
        joinTime: row.join_time,
        leaveTime: row.leave_time,
        confidenceScore: row.confidence_score,
        prickle: prickle ? toDetail(prickle) : null,
      };
    });
  }

  async attendeesOf(prickleId: string, { includeEmail = false }: { includeEmail?: boolean } = {}): Promise<Attendee[]> {
    const rows = await fetchAllRows<AttendeeRow>((from, to) =>
      this.db
        .from("prickle_attendance")
        .select(`${ATTENDEE_COLUMNS}, ${attendeeEmbed(includeEmail, true)}`)
        .eq("prickle_id", prickleId)
        .order("join_time")
        .order("id")
        .range(from, to)
        .overrideTypes<AttendeeRow[], { merge: false }>(), // runtime select string: rows typed by hand
    );
    return rows.map(toAttendee);
  }

  async coAttendees(memberId: string, prickleIds: string[]): Promise<Attendee[]> {
    return inChunks(prickleIds, ID_CHUNK_SIZE, async (ids) => {
      const rows = await fetchAllRows<AttendeeRow>((from, to) =>
        this.db
          .from("prickle_attendance")
          .select(`${ATTENDEE_COLUMNS}, ${attendeeEmbed(false, false)}`)
          .in("prickle_id", ids)
          .neq("member_id", memberId)
          .order("id")
          .range(from, to)
          .overrideTypes<AttendeeRow[], { merge: false }>(), // runtime select string: rows typed by hand
      );
      return rows.map(toAttendee);
    });
  }

  async attendeesJoinedBetween(from: string, to: string): Promise<Attendee[]> {
    const rows = await fetchAllRows<AttendeeRow>((start, end) =>
      this.db
        .from("prickle_attendance")
        .select(`${ATTENDEE_COLUMNS}, ${attendeeEmbed(false, false)}`)
        .gte("join_time", from)
        .lte("join_time", to)
        .order("id")
        .range(start, end)
        .overrideTypes<AttendeeRow[], { merge: false }>(), // runtime select string: rows typed by hand
    );
    return rows.map(toAttendee);
  }

  async reassign(fromMemberId: string, toMemberId: string): Promise<void> {
    const { error } = await this.db.from("prickle_attendance").update({ member_id: toMemberId }).eq("member_id", fromMemberId);
    if (error) throw new Error(error.message);
  }
}

const toLink = (row: AttendanceRow): AttendanceLink => ({
  memberId: row.memberId,
  prickleId: row.prickleId,
  joinTime: row.joinTime,
});

/**
 * In-memory twin for tests, demos and seed profiles. Same rules as the Supabase one (distinct
 * prickles, several records per prickle allowed); seed it with typed `AttendanceRow`s.
 */
export class InMemoryAttendanceRepository implements AttendanceRepository {
  private readonly data: InMemoryDataset;

  /** Seed with attendance rows alone, or share an `InMemoryDataset` with the other in-memory repositories. */
  constructor(source: AttendanceRow[] | InMemoryDataset = []) {
    this.data = Array.isArray(source) ? new InMemoryDataset({ attendance: source }) : source;
  }

  private get rows(): AttendanceRow[] {
    return this.data.attendance;
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

  async list() {
    return this.rows.map(toLink);
  }

  async forPrickles(prickleIds: string[]) {
    const wanted = new Set(prickleIds);
    return this.rows.filter((row) => wanted.has(row.prickleId)).map(toLink);
  }

  async prickleIdsWithAttendance(prickleIds: string[]) {
    const wanted = new Set(prickleIds);
    return new Set(this.rows.filter((row) => wanted.has(row.prickleId)).map((row) => row.prickleId));
  }

  async attendedAmong(memberId: string, prickleIds: string[]) {
    return new Set((await this.earliestJoinByPrickle(memberId, prickleIds)).keys());
  }

  async earliestJoinByPrickle(memberId: string, prickleIds: string[]) {
    const wanted = new Set(prickleIds);
    const earliest = new Map<string, string>();
    for (const row of this.rows) {
      if (row.memberId !== memberId || !wanted.has(row.prickleId)) continue;
      const seen = earliest.get(row.prickleId);
      if (!seen || new Date(row.joinTime) < new Date(seen)) earliest.set(row.prickleId, row.joinTime);
    }
    return earliest;
  }

  async joinedBetween(from: string, to: string) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.rows
      .filter((row) => new Date(row.joinTime).getTime() >= start && new Date(row.joinTime).getTime() <= end)
      .map((row) => ({ memberId: row.memberId, joinTime: row.joinTime, leaveTime: row.leaveTime }));
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

  async lastJoinTime(memberId: string, { before }: { before?: string } = {}) {
    const limit = before ? new Date(before).getTime() : Infinity;
    const times = this.rows
      .filter((row) => row.memberId === memberId && new Date(row.joinTime).getTime() <= limit)
      .map((row) => row.joinTime);
    if (times.length === 0) return null;
    return times.reduce((latest, time) => (new Date(time) > new Date(latest) ? time : latest));
  }

  async forMemberWithPrickles(memberId: string, { purpose, prickleStartedSince }: MemberAttendanceFilter = {}) {
    const since = prickleStartedSince ? new Date(prickleStartedSince).getTime() : -Infinity;
    const attended: AttendedPrickle[] = [];
    for (const row of this.rows) {
      if (row.memberId !== memberId) continue;
      const found = this.data.prickles.find((p) => p.id === row.prickleId);
      const prickle = found ? prickleDetail(this.data, found) : null;
      const filtered = purpose !== undefined || prickleStartedSince !== undefined;
      if (filtered && (!prickle || (purpose !== undefined && prickle.type?.purpose !== purpose) || new Date(prickle.startTime).getTime() < since)) {
        continue;
      }
      attended.push({
        id: row.id,
        prickleId: row.prickleId,
        joinTime: row.joinTime,
        leaveTime: row.leaveTime,
        confidenceScore: row.confidenceScore ?? "high",
        prickle,
      });
    }
    return attended.sort((a, b) => b.joinTime.localeCompare(a.joinTime) || a.id.localeCompare(b.id));
  }

  private attendee(row: AttendanceRow, includeEmail: boolean): Attendee {
    const member = this.data.members.find((m) => m.id === row.memberId);
    return {
      id: row.id,
      memberId: row.memberId,
      prickleId: row.prickleId,
      joinTime: row.joinTime,
      leaveTime: row.leaveTime,
      confidenceScore: row.confidenceScore ?? "high",
      name: member?.name ?? null,
      displayName: member?.displayName ?? null,
      email: includeEmail ? (member?.email ?? null) : null,
    };
  }

  async attendeesOf(prickleId: string, { includeEmail = false }: { includeEmail?: boolean } = {}) {
    return this.rows
      .filter((row) => row.prickleId === prickleId && this.data.members.some((m) => m.id === row.memberId))
      .map((row) => this.attendee(row, includeEmail))
      .sort((a, b) => a.joinTime.localeCompare(b.joinTime) || a.id.localeCompare(b.id));
  }

  async coAttendees(memberId: string, prickleIds: string[]) {
    const wanted = new Set(prickleIds);
    return this.rows.filter((row) => row.memberId !== memberId && wanted.has(row.prickleId)).map((row) => this.attendee(row, false));
  }

  async attendeesJoinedBetween(from: string, to: string) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.rows
      .filter((row) => new Date(row.joinTime).getTime() >= start && new Date(row.joinTime).getTime() <= end)
      .map((row) => this.attendee(row, false));
  }

  async reassign(fromMemberId: string, toMemberId: string) {
    for (const row of this.rows) if (row.memberId === fromMemberId) row.memberId = toMemberId;
  }
}
