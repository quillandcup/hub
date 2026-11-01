import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId, compareText, type Page } from "./query";
import type { Database } from "./database.types";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A Big Sister match (`mentorships`): admin-only, since it names new members. */
export type MentorshipRecord = Row<"mentorships">;
export type NewMentorship = Pick<Insert<"mentorships">, "mentor_member_id" | "new_member_id" | "started_on"> & { kind: string; trial_ends_on?: string | null };
export type MentorshipPatch = Pick<Update<"mentorships">, "outcome_note" | "status">;

/** The slice of a member a match shows and the trial outcome is derived from. */
export type MentorshipMember = {
  id: string;
  name: string;
  display_name: string | null;
  status: string | null;
  first_joined_at: string | null;
  most_recent_joined_at: string | null;
};

/** A match with both members joined in (null when the member no longer exists). */
export type MentorshipWithMembers = Pick<
  MentorshipRecord,
  "id" | "mentor_member_id" | "new_member_id" | "started_on" | "trial_ends_on" | "kind" | "status" | "outcome_note"
> & { mentor: MentorshipMember | null; new_member: MentorshipMember | null };

/** The new member and start day of a live match: what tells an arrival it already has a big sister. */
export type MatchedArrival = Pick<MentorshipRecord, "new_member_id" | "started_on">;

/** The outcome of writing a match: the database allows one live match per arrival, which is a case, not a failure. */
export type MatchResult = { ok: true } | { ok: false; reason: "already_matched" };

/** A member who volunteered to be a big sister, with their name. */
export type VolunteerWithMember = Pick<Row<"big_sister_volunteers">, "member_id" | "note" | "created_at"> & {
  member: { name: string; display_name: string | null } | null;
};

/** One row of `mentorship_counts()`: a mentor's live matches that have started. */
export type MentorshipCountRow = Database["public"]["Functions"]["mentorship_counts"]["Returns"][number];
/**
 * One row of `my_mentorships()`: a match from one side's point of view. `viewer_role` is "big_sister" or "new_member"; the
 * `other_*` membership columns are only given to a big sister (null for a new member).
 */
export type MyMentorshipRow = {
  mentorship_id: string;
  viewer_role: string;
  other_member_id: string;
  other_name: string;
  other_display_name: string | null;
  other_photo_url: string | null;
  started_on: string;
  trial_ends_on: string | null;
  kind: string;
  outcome_note: string | null;
  other_status: string | null;
  other_first_joined_at: string | null;
  other_most_recent_joined_at: string | null;
};

const MEMBER_COLUMNS = "id, name, display_name, status, first_joined_at, most_recent_joined_at";
const WITH_MEMBERS = `id, mentor_member_id, new_member_id, started_on, trial_ends_on, kind, status, outcome_note,
  mentor:members!mentorships_mentor_member_id_fkey(${MEMBER_COLUMNS}),
  new_member:members!mentorships_new_member_id_fkey(${MEMBER_COLUMNS})`;

/** PostgREST returns a to-one embed as an object, though callers have also met it as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

type WithMembersRow = Omit<MentorshipWithMembers, "mentor" | "new_member"> & {
  mentor: MentorshipMember | MentorshipMember[] | null;
  new_member: MentorshipMember | MentorshipMember[] | null;
};

/**
 * The Big Sister program (`mentorships`, `big_sister_volunteers`, and the functions over them). Matches are
 * admin-only; a member reads their own side through `myMentorships` and a big sister writes the reason a trial
 * did not continue through `setNote` (security definer functions that check the caller). The functions answer for
 * the signed-in caller, so a service-role client gets no rows from `myMentorships` and false from `setNote`.
 * Every method throws on a database error; scans are paginated.
 */
export interface MentorshipRepository {
  // --- matches ---
  /** Every match, newest start first, with both members joined in. Paginated. */
  listWithMembers(): Promise<MentorshipWithMembers[]>;
  /** The new member and start day of every live (matched) match. Paginated. */
  matchedArrivals(): Promise<MatchedArrival[]>;
  /** Records a match. `already_matched` when that arrival has a live match already. */
  create(match: NewMentorship): Promise<MatchResult>;
  /** Changes a match's note or status (nothing happens when there is no such match). `already_matched` when it would be a second live match for the arrival. */
  update(id: string, patch: MentorshipPatch): Promise<MatchResult>;
  delete(id: string): Promise<void>;

  // --- volunteers ---
  /** Current volunteers (not withdrawn) with their names, ordered by member. Paginated. */
  volunteers(): Promise<VolunteerWithMember[]>;
  /** The note a current volunteer left for staff (itself null when they left none); null when they are not volunteering. */
  volunteerNote(memberId: string): Promise<{ note: string | null } | null>;
  /** Puts a member on the volunteer pool, or back on it after they withdrew. */
  volunteer(memberId: string, note: string | null): Promise<void>;
  /** Takes a member off the pool (kept as history). */
  withdraw(memberId: string): Promise<void>;

  // --- functions ---
  /** Live matches per mentor that have started, from `mentorship_counts()` (members cannot read the table). */
  counts(): Promise<MentorshipCountRow[]>;
  /** The member's own matches, newest first, from `my_mentorships()`. */
  myMentorships(memberId: string): Promise<MyMentorshipRow[]>;
  /** A big sister's reason on their own live match, through `set_mentorship_note()`. False when it is not theirs. */
  setNote(mentorshipId: string, note: string): Promise<boolean>;
}

export class SupabaseMentorshipRepository implements MentorshipRepository {
  constructor(private readonly db: Db) {}

  async listWithMembers() {
    const rows = await fetchAllRows<WithMembersRow>(
      (from, to) =>
        this.db.from("mentorships").select(WITH_MEMBERS).order("started_on", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<Page<WithMembersRow>>,
    );
    return rows.map((r) => ({ ...r, mentor: one(r.mentor), new_member: one(r.new_member) }));
  }

  async matchedArrivals() {
    return fetchAllRows<MatchedArrival>(
      (from, to) =>
        this.db.from("mentorships").select("new_member_id, started_on").eq("status", "matched").order("id").range(from, to) as unknown as PromiseLike<Page<MatchedArrival>>,
    );
  }

  async create(match: NewMentorship): Promise<MatchResult> {
    const { error } = await this.db.from("mentorships").insert(match);
    if (error?.code === "23505") return { ok: false, reason: "already_matched" };
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async update(id: string, patch: MentorshipPatch): Promise<MatchResult> {
    const { error } = await this.db.from("mentorships").update(patch).eq("id", id);
    if (error?.code === "23505") return { ok: false, reason: "already_matched" };
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async delete(id: string) {
    const { error } = await this.db.from("mentorships").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async volunteers() {
    const rows = await fetchAllRows<VolunteerWithMember & { member: unknown }>(
      (from, to) =>
        this.db
          .from("big_sister_volunteers")
          .select("member_id, note, created_at, member:members(name, display_name)")
          .is("deleted_at", null)
          .order("member_id")
          .range(from, to) as unknown as PromiseLike<Page<VolunteerWithMember & { member: unknown }>>,
    );
    return rows.map((r) => ({ ...r, member: one(r.member as VolunteerWithMember["member"] | VolunteerWithMember["member"][]) }));
  }

  async volunteerNote(memberId: string) {
    const { data, error } = await this.db.from("big_sister_volunteers").select("note").eq("member_id", memberId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async volunteer(memberId: string, note: string | null) {
    const { error } = await this.db.from("big_sister_volunteers").upsert({ member_id: memberId, note, deleted_at: null }, { onConflict: "member_id" });
    if (error) throw new Error(error.message);
  }

  async withdraw(memberId: string) {
    const { error } = await this.db
      .from("big_sister_volunteers")
      .update({ deleted_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async counts() {
    const { data, error } = await this.db.rpc("mentorship_counts");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async myMentorships(memberId: string) {
    const { data, error } = await this.db.rpc("my_mentorships", { p_member_id: memberId });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as MyMentorshipRow[];
  }

  async setNote(mentorshipId: string, note: string) {
    const { data, error } = await this.db.rpc("set_mentorship_note", { p_mentorship_id: mentorshipId, p_note: note });
    if (error) throw new Error(error.message);
    return data === true;
  }
}

/**
 * In-memory twin over an `InMemoryDataset`. Without a signed-in caller to check, the functions answer for
 * whoever is asked about: `myMentorships` returns that member's side and `setNote` writes any live match's note.
 */
export class InMemoryMentorshipRepository implements MentorshipRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private memberOf(id: string): MentorshipMember | null {
    const m = this.data.members.find((x) => x.id === id);
    return m
      ? { id: m.id, name: m.name, display_name: m.displayName ?? null, status: m.status ?? "active", first_joined_at: m.firstJoinedAt ?? null, most_recent_joined_at: m.mostRecentJoinedAt ?? null }
      : null;
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  private hasLiveMatch(row: Pick<MentorshipRecord, "id" | "new_member_id" | "started_on">) {
    return this.data.mentorships.some((m) => m.id !== row.id && m.status === "matched" && m.new_member_id === row.new_member_id && m.started_on === row.started_on);
  }

  async listWithMembers() {
    const newestFirst = byKeyThenId<MentorshipRecord>((m) => m.started_on, (m) => m.id, true);
    return [...this.data.mentorships].sort(newestFirst).map((m) => ({
      id: m.id,
      mentor_member_id: m.mentor_member_id,
      new_member_id: m.new_member_id,
      started_on: m.started_on,
      trial_ends_on: m.trial_ends_on,
      kind: m.kind,
      status: m.status,
      outcome_note: m.outcome_note,
      mentor: this.memberOf(m.mentor_member_id),
      new_member: this.memberOf(m.new_member_id),
    }));
  }

  async matchedArrivals() {
    return this.data.mentorships.filter((m) => m.status === "matched").map(({ new_member_id, started_on }) => ({ new_member_id, started_on }));
  }

  async create(match: NewMentorship): Promise<MatchResult> {
    for (const id of [match.mentor_member_id, match.new_member_id]) {
      if (!this.data.members.some((m) => m.id === id)) throw new Error("violates foreign key constraint on mentorships");
    }
    const now = new Date().toISOString();
    const row: MentorshipRecord = {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      outcome_note: null,
      status: "matched",
      trial_ends_on: null,
      ...match,
    };
    if (this.hasLiveMatch(row)) return { ok: false, reason: "already_matched" };
    this.data.mentorships.push(row);
    return { ok: true };
  }

  async update(id: string, patch: MentorshipPatch): Promise<MatchResult> {
    const row = this.data.mentorships.find((m) => m.id === id);
    if (!row) return { ok: true };
    const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if (next.status === "matched" && this.hasLiveMatch(next)) return { ok: false, reason: "already_matched" };
    Object.assign(row, next, { updated_at: new Date().toISOString() });
    return { ok: true };
  }

  async delete(id: string) {
    this.data.mentorships = this.data.mentorships.filter((m) => m.id !== id);
  }

  async volunteers() {
    return this.data.bigSisterVolunteers
      .filter((v) => v.deleted_at === null)
      .sort((a, b) => compareText(a.member_id, b.member_id))
      .map((v) => {
        const m = this.memberOf(v.member_id);
        return { member_id: v.member_id, note: v.note, created_at: v.created_at, member: m && { name: m.name, display_name: m.display_name } };
      });
  }

  async volunteerNote(memberId: string) {
    const row = this.data.bigSisterVolunteers.find((v) => v.member_id === memberId && v.deleted_at === null);
    return row ? { note: row.note } : null;
  }

  async volunteer(memberId: string, note: string | null) {
    if (!this.data.members.some((m) => m.id === memberId)) throw new Error("violates foreign key constraint on member_id");
    const now = new Date().toISOString();
    const existing = this.data.bigSisterVolunteers.find((v) => v.member_id === memberId);
    if (existing) Object.assign(existing, { note, deleted_at: null, updated_at: now });
    else this.data.bigSisterVolunteers.push({ member_id: memberId, note, deleted_at: null, created_at: now, updated_at: now });
  }

  async withdraw(memberId: string) {
    const row = this.data.bigSisterVolunteers.find((v) => v.member_id === memberId && v.deleted_at === null);
    if (row) row.deleted_at = new Date().toISOString();
  }

  async counts() {
    const byMentor = new Map<string, MentorshipCountRow>();
    for (const m of this.data.mentorships) {
      if (m.status !== "matched" || m.started_on > this.today()) continue;
      const seen = byMentor.get(m.mentor_member_id);
      byMentor.set(m.mentor_member_id, {
        member_id: m.mentor_member_id,
        mentored_count: (seen?.mentored_count ?? 0) + 1,
        first_started_on: seen && seen.first_started_on < m.started_on ? seen.first_started_on : m.started_on,
        last_started_on: seen && seen.last_started_on > m.started_on ? seen.last_started_on : m.started_on,
      });
    }
    return [...byMentor.values()];
  }

  async myMentorships(memberId: string) {
    const rows: MyMentorshipRow[] = [];
    const mine = [...this.data.mentorships].filter((m) => m.status === "matched" && (m.mentor_member_id === memberId || m.new_member_id === memberId));
    for (const m of mine.sort(byKeyThenId<MentorshipRecord>((x) => x.started_on, (x) => x.id, true))) {
      const asBigSister = m.mentor_member_id === memberId;
      const other = this.data.members.find((x) => x.id === (asBigSister ? m.new_member_id : m.mentor_member_id));
      if (!other) continue;
      rows.push({
        mentorship_id: m.id,
        viewer_role: asBigSister ? "big_sister" : "new_member",
        other_member_id: other.id,
        other_name: other.name,
        other_display_name: other.displayName ?? null,
        other_photo_url: other.photoUrl ?? null,
        started_on: m.started_on,
        trial_ends_on: m.trial_ends_on,
        kind: m.kind,
        outcome_note: asBigSister ? m.outcome_note : null,
        other_status: asBigSister ? (other.status ?? "active") : null,
        other_first_joined_at: asBigSister ? (other.firstJoinedAt ?? null) : null,
        other_most_recent_joined_at: asBigSister ? (other.mostRecentJoinedAt ?? null) : null,
      });
    }
    return rows;
  }

  async setNote(mentorshipId: string, note: string) {
    if (note.length > 1000) throw new Error("note too long");
    const row = this.data.mentorships.find((m) => m.id === mentorshipId && m.status === "matched");
    if (!row) return false;
    row.outcome_note = note.trim() || null;
    return true;
  }
}
