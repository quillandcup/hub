import { randomInt } from "node:crypto";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Commitment, CommitmentSlot, CommitmentStatus } from "@/lib/commitments";
import { checkinFromRow, checkinToRow, CHECKIN_COLUMNS, isEmptyCheckin, type CheckinInput } from "@/lib/prickle-checkins";
import type { Db, Insert } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit. */
const ID_CHUNK_SIZE = 100;

/** The two halves of a prickle's check-in, each with its own table of dismissals. */
export type CheckinHalfKind = "checkin" | "checkout";

/** A slot of a stored commitment, with the name of its prickle type (null when the type is gone). */
export type StoredCommitmentSlot = CommitmentSlot & { typeName: string | null };

/** A commitment as stored: its window and status, and its slots in day-then-time order. */
export type StoredCommitment = Omit<Commitment, "slots"> & { slots: StoredCommitmentSlot[] };

/** A stored commitment as the pure commitment helpers (lib/commitments.ts) take it: slots without the type names. */
export function toPlainCommitment(c: StoredCommitment): Commitment {
  return { ...c, slots: c.slots.map((s) => ({ typeId: s.typeId, dayOfWeek: s.dayOfWeek, startTimeLocal: s.startTimeLocal, timezone: s.timezone })) };
}

export type CommitmentFilter = {
  /** Only commitments whose stored status is this. */
  status?: CommitmentStatus;
  /** Only commitments whose window ends on or after this day (YYYY-MM-DD). */
  endsOnOrAfter?: string;
};

export type NewCommitment = {
  memberId: string;
  /** First day of the window (YYYY-MM-DD, local to the slots' timezone). */
  startDate: string;
  weeks: number;
  slots: CommitmentSlot[];
  /** The Supabase Auth user who made it (an admin, in sudo); null when nobody in particular. */
  createdBy?: string | null;
};

/** Who a stored commitment belongs to and where it stands, for ownership checks. */
export type CommitmentOwner = { id: string; memberId: string; status: CommitmentStatus };

/** One commitment's claim on a weekly slot: whose, for which weeks, at what time. */
export type SlotCommitment = { memberId: string; status: CommitmentStatus; startDate: string; endDate: string; startTimeLocal: string };

/** A check-in the member rated (said whether they got what they came for), with the series of its prickle. */
export type RatedCheckin = {
  typeId: string | null;
  hostId: string | null;
  pleasantBefore: number | null;
  energyBefore: number | null;
  emotionBefore: string | null;
  need: string | null;
  intentionMet: number;
};

/** Thrown by {@link PrickleActivityRepository.createCommitment} when a slot is already committed for overlapping weeks. */
export class CommitmentConflictError extends Error {
  constructor(message = "Already committed to this slot for overlapping weeks") {
    super(message);
    this.name = "CommitmentConflictError";
  }
}

/**
 * Last day of a commitment's window, as the database's generated `end_date` column has it. Not
 * `commitmentEndDate` from lib/commitments.ts: that module imports lib/prickle-schedules, which
 * imports the repositories, and a cycle through here breaks tests that mock `createRepos`.
 */
function windowEnd(startDate: string, weeks: number): string {
  return new Date(Date.parse(`${startDate}T00:00:00Z`) + (weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
}

const pairKey =(memberId: string, prickleId: string) => `${memberId}:${prickleId}`;
const DISMISSALS_TABLE = { checkin: "prickle_checkin_dismissals", checkout: "prickle_checkout_dismissals" } as const;

const bySlotOrder = (a: { dayOfWeek: number; startTimeLocal: string }, b: { dayOfWeek: number; startTimeLocal: string }) =>
  a.dayOfWeek - b.dayOfWeek || a.startTimeLocal.localeCompare(b.startTimeLocal);
const byIdAsc = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * What members do around prickles, apart from attending: their commitments to weekly slots
 * (`prickle_commitments` with `prickle_commitment_slots`), their check-ins and check-outs
 * (`prickle_checkins`, one row per member and prickle, soft deleted when cleared) and the offers
 * they dismissed (`prickle_checkin_dismissals`, `prickle_checkout_dismissals`). Local data, not
 * reprocessed. Check-in and check-out are two halves of one feature, so the dismissal methods take
 * the half. Every method throws on a database error. The signed-in member's client runs under RLS
 * (own rows; admins read all); the check-in cron and the Slack handlers use the service role.
 */
export interface PrickleActivityRepository {
  // --- commitments ---
  /** A member's commitments, newest window first, each with its slots. Paginated. */
  commitmentsOf(memberId: string, filter?: CommitmentFilter): Promise<StoredCommitment[]>;
  /** Who a commitment belongs to, or null when there is no such commitment (or it is not visible). */
  commitmentOwner(id: string): Promise<CommitmentOwner | null>;
  /** Creates an active commitment with its slots in one step and returns its id. Throws {@link CommitmentConflictError} on an overlap. */
  createCommitment(commitment: NewCommitment): Promise<string>;
  /** Marks these commitments completed, only those still stored as active. */
  markCommitmentsCompleted(ids: string[], at: string): Promise<void>;
  /** Cancels a member's commitment. False when it was not changed (not theirs, or not visible). */
  cancelCommitment(id: string, memberId: string, at: string): Promise<boolean>;
  /** How many commitments a member has stored as active. */
  countActiveCommitments(memberId: string): Promise<number>;
  /** Every commitment's claim on one weekly slot (type, weekday, time zone), by commitment. Paginated. */
  slotCommitments(slot: { typeId: string; dayOfWeek: number; timezone: string }): Promise<SlotCommitment[]>;

  // --- check-ins (live rows only) ---
  checkinOf(memberId: string, prickleId: string): Promise<CheckinInput | null>;
  /** Every check-in a member saved, by prickle id. Paginated. */
  checkinsOf(memberId: string): Promise<Map<string, CheckinInput>>;
  /** A member's check-ins for these prickles, by prickle id. */
  checkinsAmong(memberId: string, prickleIds: string[]): Promise<Map<string, CheckinInput>>;
  /** These members' check-ins for these prickles, keyed `${memberId}:${prickleId}`. Paginated. */
  checkinsOfMembers(memberIds: string[], prickleIds: string[]): Promise<Map<string, CheckinInput>>;
  /** A member's check-ins where they said whether they got what they came for, all time, with their prickle's series. Paginated. */
  ratedCheckinsOf(memberId: string): Promise<RatedCheckin[]>;
  /** Saves a check-in (restoring one that was cleared), or, when every answer is empty, soft deletes it and keeps its last answers. */
  saveCheckin(memberId: string, prickleId: string, checkin: CheckinInput, via: "web" | "slack"): Promise<void>;

  // --- dismissals of the check-in and check-out offers ---
  /** Closes one half for a prickle; dismissing twice is fine. */
  dismiss(half: CheckinHalfKind, memberId: string, prickleId: string): Promise<void>;
  /** Which of these prickles the member dismissed this half for. */
  dismissedAmong(half: CheckinHalfKind, memberId: string, prickleIds: string[]): Promise<Set<string>>;
  /** The prickles the member dismissed this half for since this instant. */
  dismissedSince(half: CheckinHalfKind, memberId: string, since: string): Promise<Set<string>>;
  /** `${memberId}:${prickleId}` for every member's dismissal of this half for these prickles. Paginated. */
  dismissedPairs(half: CheckinHalfKind, prickleIds: string[]): Promise<Set<string>>;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

type RawSlot = { id: string; type_id: string; day_of_week: number; start_time_local: string; timezone: string; prickle_types: { name: string } | { name: string }[] | null };
type RawCommitment = { id: string; start_date: string; weeks: number; status: CommitmentStatus; cancelled_at: string | null; prickle_commitment_slots: RawSlot[] | null };

const COMMITMENT_SELECT =
  "id, start_date, weeks, status, cancelled_at, prickle_commitment_slots(id, type_id, day_of_week, start_time_local, timezone, prickle_types(name))";

function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

function toStored(row: RawCommitment): StoredCommitment {
  const slots = (row.prickle_commitment_slots ?? [])
    .map((s) => ({ id: s.id, typeId: s.type_id, dayOfWeek: s.day_of_week, startTimeLocal: s.start_time_local, timezone: s.timezone, typeName: one(s.prickle_types)?.name ?? null }))
    .sort((a, b) => bySlotOrder(a, b) || byIdAsc(a, b))
    .map((s) => ({ typeId: s.typeId, dayOfWeek: s.dayOfWeek, startTimeLocal: s.startTimeLocal, timezone: s.timezone, typeName: s.typeName }));
  return { id: row.id, startDate: row.start_date, weeks: row.weeks, status: row.status, cancelledAt: row.cancelled_at, slots };
}

export class SupabasePrickleActivityRepository implements PrickleActivityRepository {
  constructor(private readonly db: Db) {}

  async commitmentsOf(memberId: string, filter: CommitmentFilter = {}) {
    const rows = await fetchAllRows<RawCommitment>((from, to) => {
      let query = this.db.from("prickle_commitments").select(COMMITMENT_SELECT).eq("member_id", memberId);
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.endsOnOrAfter) query = query.gte("end_date", filter.endsOnOrAfter);
      return query
        .order("start_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as Page<RawCommitment>;
    });
    return rows.map(toStored);
  }

  async commitmentOwner(id: string) {
    const { data, error } = await this.db.from("prickle_commitments").select("id, member_id, status").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, memberId: data.member_id, status: data.status as CommitmentStatus } : null;
  }

  async createCommitment(c: NewCommitment) {
    const { data, error } = await this.db.rpc("create_prickle_commitment", {
      p_member_id: c.memberId,
      p_start_date: c.startDate,
      p_weeks: c.weeks,
      p_slots: c.slots.map((s) => ({ type_id: s.typeId, day_of_week: s.dayOfWeek, start_time_local: s.startTimeLocal, timezone: s.timezone })),
      // The generated type says string | undefined; the function accepts null.
      p_created_by: (c.createdBy ?? null) as string,
    });
    if (error) {
      if (error.code === "23505") throw new CommitmentConflictError(error.message);
      throw new Error(error.message);
    }
    if (!data) throw new Error("create_prickle_commitment returned no id");
    return data as string;
  }

  async markCommitmentsCompleted(ids: string[], at: string) {
    for (const part of chunk(ids, ID_CHUNK_SIZE)) {
      const { error } = await this.db.from("prickle_commitments").update({ status: "completed", updated_at: at }).in("id", part).eq("status", "active");
      if (error) throw new Error(error.message);
    }
  }

  async cancelCommitment(id: string, memberId: string, at: string) {
    const { data, error } = await this.db
      .from("prickle_commitments")
      .update({ status: "cancelled", cancelled_at: at, updated_at: at })
      .eq("id", id)
      .eq("member_id", memberId)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async countActiveCommitments(memberId: string) {
    const { count, error } = await this.db.from("prickle_commitments").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("status", "active");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async slotCommitments(slot: { typeId: string; dayOfWeek: number; timezone: string }) {
    type Raw = {
      start_time_local: string;
      prickle_commitments: { member_id: string; status: string; start_date: string; end_date: string } | { member_id: string; status: string; start_date: string; end_date: string }[] | null;
    };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("prickle_commitment_slots")
          .select("start_time_local, prickle_commitments!inner(member_id, status, start_date, end_date)")
          .eq("type_id", slot.typeId)
          .eq("day_of_week", slot.dayOfWeek)
          .eq("timezone", slot.timezone)
          .order("id")
          .range(from, to) as unknown as Page<Raw>
    );
    const out: SlotCommitment[] = [];
    for (const row of rows) {
      const c = one(row.prickle_commitments);
      if (c) out.push({ memberId: c.member_id, status: c.status as CommitmentStatus, startDate: c.start_date, endDate: c.end_date, startTimeLocal: row.start_time_local });
    }
    return out;
  }

  async checkinOf(memberId: string, prickleId: string) {
    const { data, error } = await this.db
      .from("prickle_checkins")
      .select(CHECKIN_COLUMNS)
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? checkinFromRow(data) : null;
  }

  async checkinsOf(memberId: string) {
    type Raw = Parameters<typeof checkinFromRow>[0] & { prickle_id: string };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("prickle_checkins")
          .select(`id, prickle_id, ${CHECKIN_COLUMNS}`)
          .eq("member_id", memberId)
          .is("deleted_at", null)
          .order("id")
          .range(from, to) as unknown as Page<Raw>
    );
    return new Map(rows.map((row) => [row.prickle_id, checkinFromRow(row)]));
  }

  async checkinsAmong(memberId: string, prickleIds: string[]) {
    type Raw = Parameters<typeof checkinFromRow>[0] & { prickle_id: string };
    const result = new Map<string, CheckinInput>();
    for (const part of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from("prickle_checkins")
        .select(`prickle_id, ${CHECKIN_COLUMNS}`)
        .eq("member_id", memberId)
        .in("prickle_id", part)
        .is("deleted_at", null)
        .order("id");
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Raw[]) result.set(row.prickle_id, checkinFromRow(row));
    }
    return result;
  }

  async checkinsOfMembers(memberIds: string[], prickleIds: string[]) {
    type Raw = Parameters<typeof checkinFromRow>[0] & { member_id: string; prickle_id: string };
    const result = new Map<string, CheckinInput>();
    for (const members of chunk(memberIds, ID_CHUNK_SIZE)) {
      for (const prickles of chunk(prickleIds, ID_CHUNK_SIZE)) {
        const rows = await fetchAllRows<Raw>(
          (from, to) =>
            this.db
              .from("prickle_checkins")
              .select(`id, member_id, prickle_id, ${CHECKIN_COLUMNS}`)
              .in("member_id", members)
              .in("prickle_id", prickles)
              .is("deleted_at", null)
              .order("id")
              .range(from, to) as unknown as Page<Raw>
        );
        for (const row of rows) result.set(pairKey(row.member_id, row.prickle_id), checkinFromRow(row));
      }
    }
    return result;
  }

  async ratedCheckinsOf(memberId: string) {
    type Raw = {
      pleasant_before: number | null;
      energy_before: number | null;
      emotion_before: string | null;
      need: string | null;
      intention_met: number;
      prickles: { type_id: string | null; host: string | null } | { type_id: string | null; host: string | null }[] | null;
    };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("prickle_checkins")
          .select("pleasant_before, energy_before, emotion_before, need, intention_met, prickles!inner(type_id, host)")
          .eq("member_id", memberId)
          .is("deleted_at", null)
          .not("intention_met", "is", null)
          .order("id")
          .range(from, to) as unknown as Page<Raw>
    );
    return rows.map((r) => {
      const prickle = one(r.prickles);
      return {
        typeId: prickle?.type_id ?? null,
        hostId: prickle?.host ?? null,
        pleasantBefore: r.pleasant_before,
        energyBefore: r.energy_before,
        emotionBefore: r.emotion_before,
        need: r.need,
        intentionMet: r.intention_met,
      };
    });
  }

  async saveCheckin(memberId: string, prickleId: string, checkin: CheckinInput, via: "web" | "slack") {
    if (isEmptyCheckin(checkin)) {
      const { error } = await this.db
        .from("prickle_checkins")
        .update({ deleted_at: new Date().toISOString(), saved_via: via })
        .eq("member_id", memberId)
        .eq("prickle_id", prickleId)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      return;
    }
    const row: Insert<"prickle_checkins"> = { member_id: memberId, prickle_id: prickleId, ...checkinToRow(checkin), saved_via: via, deleted_at: null };
    const { error } = await this.db.from("prickle_checkins").upsert(row, { onConflict: "member_id,prickle_id" });
    if (error) throw new Error(error.message);
  }

  async dismiss(half: CheckinHalfKind, memberId: string, prickleId: string) {
    const { error } = await this.db
      .from(DISMISSALS_TABLE[half])
      .upsert({ member_id: memberId, prickle_id: prickleId }, { onConflict: "member_id,prickle_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async dismissedAmong(half: CheckinHalfKind, memberId: string, prickleIds: string[]) {
    const ids = new Set<string>();
    for (const part of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const { data, error } = await this.db.from(DISMISSALS_TABLE[half]).select("prickle_id").eq("member_id", memberId).in("prickle_id", part);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) ids.add(row.prickle_id);
    }
    return ids;
  }

  async dismissedSince(half: CheckinHalfKind, memberId: string, since: string) {
    const rows = await fetchAllRows<{ prickle_id: string }>(
      (from, to) =>
        this.db
          .from(DISMISSALS_TABLE[half])
          .select("id, prickle_id")
          .eq("member_id", memberId)
          .gte("dismissed_at", since)
          .order("id")
          .range(from, to) as unknown as Page<{ prickle_id: string }>
    );
    return new Set(rows.map((r) => r.prickle_id));
  }

  async dismissedPairs(half: CheckinHalfKind, prickleIds: string[]) {
    const pairs = new Set<string>();
    for (const part of chunk(prickleIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<{ member_id: string; prickle_id: string }>(
        (from, to) =>
          this.db.from(DISMISSALS_TABLE[half]).select("id, member_id, prickle_id").in("prickle_id", part).order("id").range(from, to) as unknown as Page<{
            member_id: string;
            prickle_id: string;
          }>
      );
      for (const r of rows) pairs.add(pairKey(r.member_id, r.prickle_id));
    }
    return pairs;
  }
}

// --- in-memory twin ---

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const newId = (prefix: string) => `${prefix}_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

/** A commitment as a test or seed profile writes it. A slot's time is "HH:MM" or "HH:MM:SS"; the database returns "HH:MM:SS". */
export type CommitmentSeed = {
  id: string;
  memberId: string;
  startDate: string;
  weeks: number;
  /** "active" when not given. */
  status?: CommitmentStatus;
  cancelledAt?: string | null;
  createdAt?: string;
  slots: CommitmentSlot[];
};

/** A saved check-in as a test or seed profile writes it. */
export type CheckinSeed = {
  memberId: string;
  prickleId: string;
  checkin: CheckinInput;
  /** Set on a cleared check-in, which keeps its answers. */
  deletedAt?: string | null;
  savedVia?: "web" | "slack";
};

/** A dismissed check-in or check-out offer. */
export type DismissalSeed = { memberId: string; prickleId: string; dismissedAt?: string };

const withSeconds = (time: string) => (time.length === 5 ? `${time}:00` : time);
const sameTime = (a: string, b: string) => withSeconds(a) === withSeconds(b);

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryPrickleActivityRepository implements PrickleActivityRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private stored(c: CommitmentSeed): StoredCommitment {
    return {
      id: c.id,
      startDate: c.startDate,
      weeks: c.weeks,
      status: c.status ?? "active",
      cancelledAt: c.cancelledAt ?? null,
      slots: c.slots
        .map((s) => ({ ...s, startTimeLocal: withSeconds(s.startTimeLocal), typeName: this.data.prickleTypes.find((t) => t.id === s.typeId)?.name ?? null }))
        .sort(bySlotOrder),
    };
  }

  private liveCheckins() {
    return this.data.prickleCheckins.filter((c) => (c.deletedAt ?? null) === null);
  }

  async commitmentsOf(memberId: string, filter: CommitmentFilter = {}) {
    return this.data.prickleCommitments
      .filter((c) => c.memberId === memberId)
      .filter((c) => !filter.status || (c.status ?? "active") === filter.status)
      .filter((c) => !filter.endsOnOrAfter || windowEnd(c.startDate, c.weeks) >= filter.endsOnOrAfter)
      .sort((a, b) => (a.startDate !== b.startDate ? (a.startDate < b.startDate ? 1 : -1) : (a.createdAt ?? "") !== (b.createdAt ?? "") ? ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1) : byIdAsc(a, b)))
      .map((c) => this.stored(c));
  }

  async commitmentOwner(id: string) {
    const c = this.data.prickleCommitments.find((x) => x.id === id);
    return c ? { id: c.id, memberId: c.memberId, status: c.status ?? "active" } : null;
  }

  async createCommitment(c: NewCommitment) {
    if (c.slots.length === 0) throw new Error("A commitment needs at least one slot");
    const end = windowEnd(c.startDate, c.weeks);
    const clash = this.data.prickleCommitments.some(
      (other) =>
        other.memberId === c.memberId &&
        (other.status ?? "active") === "active" &&
        other.startDate <= end &&
        c.startDate <= windowEnd(other.startDate, other.weeks) &&
        other.slots.some((os) => c.slots.some((s) => os.typeId === s.typeId && os.dayOfWeek === s.dayOfWeek && sameTime(os.startTimeLocal, s.startTimeLocal) && os.timezone === s.timezone))
    );
    if (clash) throw new CommitmentConflictError();
    const id = newId("pcmt");
    this.data.prickleCommitments.push({ id, memberId: c.memberId, startDate: c.startDate, weeks: c.weeks, status: "active", cancelledAt: null, createdAt: new Date().toISOString(), slots: c.slots.map((s) => ({ ...s })) });
    return id;
  }

  async markCommitmentsCompleted(ids: string[]) {
    for (const c of this.data.prickleCommitments) if (ids.includes(c.id) && (c.status ?? "active") === "active") c.status = "completed";
  }

  async cancelCommitment(id: string, memberId: string, at: string) {
    const c = this.data.prickleCommitments.find((x) => x.id === id && x.memberId === memberId);
    if (!c) return false;
    c.status = "cancelled";
    c.cancelledAt = at;
    return true;
  }

  async countActiveCommitments(memberId: string) {
    return this.data.prickleCommitments.filter((c) => c.memberId === memberId && (c.status ?? "active") === "active").length;
  }

  async slotCommitments(slot: { typeId: string; dayOfWeek: number; timezone: string }) {
    return this.data.prickleCommitments.flatMap((c) =>
      c.slots
        .filter((s) => s.typeId === slot.typeId && s.dayOfWeek === slot.dayOfWeek && s.timezone === slot.timezone)
        .map((s) => ({ memberId: c.memberId, status: c.status ?? "active", startDate: c.startDate, endDate: windowEnd(c.startDate, c.weeks), startTimeLocal: withSeconds(s.startTimeLocal) }))
    );
  }

  async checkinOf(memberId: string, prickleId: string) {
    const row = this.liveCheckins().find((c) => c.memberId === memberId && c.prickleId === prickleId);
    return row ? { ...row.checkin } : null;
  }

  async checkinsOf(memberId: string) {
    return new Map(this.liveCheckins().filter((c) => c.memberId === memberId).map((c) => [c.prickleId, { ...c.checkin }]));
  }

  async checkinsAmong(memberId: string, prickleIds: string[]) {
    return new Map(this.liveCheckins().filter((c) => c.memberId === memberId && prickleIds.includes(c.prickleId)).map((c) => [c.prickleId, { ...c.checkin }]));
  }

  async checkinsOfMembers(memberIds: string[], prickleIds: string[]) {
    return new Map(
      this.liveCheckins()
        .filter((c) => memberIds.includes(c.memberId) && prickleIds.includes(c.prickleId))
        .map((c) => [pairKey(c.memberId, c.prickleId), { ...c.checkin }])
    );
  }

  async ratedCheckinsOf(memberId: string) {
    const out: RatedCheckin[] = [];
    for (const c of this.liveCheckins()) {
      if (c.memberId !== memberId || c.checkin.intentionMet === null) continue;
      const prickle = this.data.prickles.find((p) => p.id === c.prickleId);
      if (!prickle) continue;
      out.push({
        typeId: prickle.typeId,
        hostId: prickle.hostId,
        pleasantBefore: c.checkin.pleasantBefore,
        energyBefore: c.checkin.energyBefore,
        emotionBefore: c.checkin.emotionBefore,
        need: c.checkin.need,
        intentionMet: c.checkin.intentionMet,
      });
    }
    return out;
  }

  async saveCheckin(memberId: string, prickleId: string, checkin: CheckinInput, via: "web" | "slack") {
    const index = this.data.prickleCheckins.findIndex((c) => c.memberId === memberId && c.prickleId === prickleId);
    if (isEmptyCheckin(checkin)) {
      if (index >= 0 && (this.data.prickleCheckins[index].deletedAt ?? null) === null) {
        this.data.prickleCheckins[index] = { ...this.data.prickleCheckins[index], deletedAt: new Date().toISOString(), savedVia: via };
      }
      return;
    }
    const row: CheckinSeed = { memberId, prickleId, checkin: { ...checkin }, deletedAt: null, savedVia: via };
    if (index >= 0) this.data.prickleCheckins[index] = row;
    else this.data.prickleCheckins.push(row);
  }

  private dismissals(half: CheckinHalfKind) {
    return half === "checkin" ? this.data.checkinDismissals : this.data.checkoutDismissals;
  }

  async dismiss(half: CheckinHalfKind, memberId: string, prickleId: string) {
    const rows = this.dismissals(half);
    if (!rows.some((r) => r.memberId === memberId && r.prickleId === prickleId)) rows.push({ memberId, prickleId, dismissedAt: new Date().toISOString() });
  }

  async dismissedAmong(half: CheckinHalfKind, memberId: string, prickleIds: string[]) {
    return new Set(this.dismissals(half).filter((r) => r.memberId === memberId && prickleIds.includes(r.prickleId)).map((r) => r.prickleId));
  }

  async dismissedSince(half: CheckinHalfKind, memberId: string, since: string) {
    return new Set(this.dismissals(half).filter((r) => r.memberId === memberId && (r.dismissedAt ?? "") >= since).map((r) => r.prickleId));
  }

  async dismissedPairs(half: CheckinHalfKind, prickleIds: string[]) {
    return new Set(this.dismissals(half).filter((r) => prickleIds.includes(r.prickleId)).map((r) => pairKey(r.memberId, r.prickleId)));
  }
}
