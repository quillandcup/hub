import type { MilestoneAnswer, MilestoneKind, MilestoneSource, MilestoneStatus } from "@/lib/finishers";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { byKeyThenId, must } from "./query";

/** A Finisher milestone a member claims or staff proposed (`member_milestones`). Withdrawing one is a soft delete. */
export type MilestoneRow = Row<"member_milestones">;

/** What the member's card shows of a milestone. */
export type Milestone = {
  id: string;
  memberId: string;
  kind: MilestoneKind;
  status: MilestoneStatus;
  source: MilestoneSource;
  achievedOn: string | null;
  storyBefore: string | null;
  storyAfter: string | null;
  consentProfile: boolean;
  consentHomepage: boolean;
  consentTestimonial: boolean;
  confirmedAt: string | null;
  createdAt: string;
};

/** A milestone as the staff list shows it: the member's names, never the stories. */
export type StaffMilestone = Pick<Milestone, "id" | "memberId" | "kind" | "status" | "source" | "achievedOn" | "createdAt"> & {
  name: string;
  displayName: string | null;
};

export type MilestoneCounts = Record<MilestoneStatus, number>;

/** What the staff add by hand for one member. */
export type MilestoneProposal = {
  memberId: string;
  kind: MilestoneKind;
  achievedOn: string | null;
  /** The signed-in staff user (an auth user id). */
  createdBy: string;
};

const COLUMNS =
  "id, member_id, kind, status, source, achieved_on, story_before, story_after, consent_profile, consent_homepage, consent_testimonial, confirmed_at, created_at";

type MilestoneColumns = Pick<
  MilestoneRow,
  | "id" | "member_id" | "kind" | "status" | "source" | "achieved_on" | "story_before" | "story_after"
  | "consent_profile" | "consent_homepage" | "consent_testimonial" | "confirmed_at" | "created_at"
>;

// The check constraints hold kind, status and source to these values; the generated types see plain text.
function toMilestone(r: MilestoneColumns): Milestone {
  return {
    id: r.id,
    memberId: r.member_id,
    kind: r.kind as MilestoneKind,
    status: r.status as MilestoneStatus,
    source: r.source as MilestoneSource,
    achievedOn: r.achieved_on,
    storyBefore: r.story_before,
    storyAfter: r.story_after,
    consentProfile: r.consent_profile,
    consentHomepage: r.consent_homepage,
    consentTestimonial: r.consent_testimonial,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
  };
}

const STATUSES: readonly MilestoneStatus[] = ["proposed", "confirmed", "declined"];

/** The columns an answer writes. A decline clears every consent, because a consent only exists on a confirmed row. */
function answerColumns(answer: MilestoneAnswer, nowIso: string) {
  if (answer.status === "declined") {
    return { status: "declined", confirmed_at: null, consent_profile: false, consent_homepage: false, consent_testimonial: false, updated_at: nowIso };
  }
  return {
    status: "confirmed",
    confirmed_at: nowIso,
    achieved_on: answer.achievedOn,
    story_before: answer.storyBefore,
    story_after: answer.storyAfter,
    consent_profile: answer.consent_profile,
    consent_homepage: answer.consent_homepage,
    consent_testimonial: answer.consent_testimonial,
    updated_at: nowIso,
  };
}

/**
 * The Finisher record (`member_milestones`, docs/FINISHERS.md). Under a member's own client the rows are theirs alone;
 * under an admin's they are all rows, but an admin can only add proposals and edit or withdraw ones that are still
 * proposals. Only live rows (`deleted_at` null) are read or changed. Every method throws on a database error.
 */
export interface MilestoneRepository {
  /** The member's own live milestones, THE END first. */
  ofMember(memberId: string): Promise<Milestone[]>;
  /** How many live milestones are in each status. */
  counts(): Promise<MilestoneCounts>;
  /** Live milestones for the staff list, newest first (then id), one page; optionally one status. */
  page(options: { status?: MilestoneStatus; limit: number; offset: number }): Promise<StaffMilestone[]>;
  /**
   * Staff backfill: proposes both milestones for every member with a live book who has no milestone of that kind yet
   * (any status, withdrawn ones included). One statement, so there is no page limit; a second run adds nothing.
   * Returns how many rows it added.
   */
  proposeFromBooks(): Promise<number>;
  /** Staff add one by hand, as a proposal. "exists" when the member already has a live one of that kind. */
  propose(proposal: MilestoneProposal): Promise<"added" | "exists">;
  /** Staff take back a proposal the member has not answered. False when there is no such live proposal. */
  withdraw(id: string): Promise<boolean>;
  /** The member answers (or changes their answer). False when the member has no such live milestone. */
  answer(id: string, memberId: string, answer: MilestoneAnswer, now: Date): Promise<boolean>;
}

export class SupabaseMilestoneRepository implements MilestoneRepository {
  constructor(private readonly db: Db) {}

  async ofMember(memberId: string) {
    const { data, error } = await this.db
      .from("member_milestones")
      .select(COLUMNS)
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("kind", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toMilestone);
  }

  async counts() {
    const entries = await Promise.all(
      STATUSES.map(async (status) => {
        const { count, error } = await this.db
          .from("member_milestones")
          .select("id", { count: "exact", head: true })
          .eq("status", status)
          .is("deleted_at", null);
        if (error) throw new Error(error.message);
        return [status, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(entries) as MilestoneCounts;
  }

  async page({ status, limit, offset }: { status?: MilestoneStatus; limit: number; offset: number }) {
    let query = this.db
      .from("member_milestones")
      .select("id, member_id, kind, status, source, achieved_on, created_at, member:members(name, display_name)")
      .is("deleted_at", null);
    if (status) query = query.eq("status", status);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      memberId: r.member_id,
      kind: r.kind as MilestoneKind,
      status: r.status as MilestoneStatus,
      source: r.source as MilestoneSource,
      achievedOn: r.achieved_on,
      createdAt: r.created_at,
      name: r.member?.name ?? "",
      displayName: r.member?.display_name ?? null,
    }));
  }

  async proposeFromBooks() {
    const added = must(await this.db.rpc("propose_milestones_from_books"));
    return added ?? 0;
  }

  async propose(p: MilestoneProposal) {
    const { error } = await this.db.from("member_milestones").insert({
      member_id: p.memberId,
      kind: p.kind,
      achieved_on: p.achievedOn,
      source: "staff",
      status: "proposed",
      created_by: p.createdBy,
    });
    if (error) {
      if (error.code === "23505") return "exists";
      throw new Error(error.message);
    }
    return "added";
  }

  async withdraw(id: string) {
    const { data, error } = await this.db
      .from("member_milestones")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "proposed")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async answer(id: string, memberId: string, answer: MilestoneAnswer, now: Date) {
    const { data, error } = await this.db
      .from("member_milestones")
      .update(answerColumns(answer, now.toISOString()))
      .eq("id", id)
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }
}

/** In-memory twin over an `InMemoryDataset`. It enforces the same uniqueness and consent rules as the table. */
export class InMemoryMilestoneRepository implements MilestoneRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.memberMilestones.filter((m) => m.deleted_at === null);
  }

  async ofMember(memberId: string) {
    return this.live()
      .filter((m) => m.member_id === memberId)
      .sort(byKeyThenId<MilestoneRow>((m) => m.kind, (m) => m.id, true))
      .map(toMilestone);
  }

  async counts() {
    const counts: MilestoneCounts = { proposed: 0, confirmed: 0, declined: 0 };
    for (const m of this.live()) counts[m.status as MilestoneStatus] += 1;
    return counts;
  }

  async page({ status, limit, offset }: { status?: MilestoneStatus; limit: number; offset: number }) {
    return this.live()
      .filter((m) => !status || m.status === status)
      .sort(byKeyThenId<MilestoneRow>((m) => m.created_at, (m) => m.id, true))
      .slice(offset, offset + limit)
      .map((m) => {
        const member = this.data.members.find((x) => x.id === m.member_id);
        return {
          id: m.id,
          memberId: m.member_id,
          kind: m.kind as MilestoneKind,
          status: m.status as MilestoneStatus,
          source: m.source as MilestoneSource,
          achievedOn: m.achieved_on,
          createdAt: m.created_at,
          name: member?.name ?? "",
          displayName: member?.displayName ?? null,
        };
      });
  }

  private add(memberId: string, kind: MilestoneKind, achievedOn: string | null, createdBy: string | null) {
    const now = new Date().toISOString();
    this.data.memberMilestones.push({
      id: `mlst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      kind,
      project_id: null,
      book_id: null,
      achieved_on: achievedOn,
      story_before: null,
      story_after: null,
      source: "staff",
      status: "proposed",
      consent_profile: false,
      consent_homepage: false,
      consent_testimonial: false,
      created_by: createdBy,
      confirmed_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  }

  async proposeFromBooks() {
    const authors = new Set(this.data.memberBooks.filter((b) => (b.deleted_at ?? null) === null).map((b) => b.member_id));
    let added = 0;
    for (const memberId of [...authors].sort()) {
      for (const kind of ["the_end", "publish_ready"] as const) {
        // Any row of that kind, withdrawn or answered, keeps the member from being proposed again.
        if (this.data.memberMilestones.some((m) => m.member_id === memberId && m.kind === kind)) continue;
        this.add(memberId, kind, null, null);
        added += 1;
      }
    }
    return added;
  }

  async propose(p: MilestoneProposal) {
    if (!this.data.members.some((m) => m.id === p.memberId)) throw new Error("violates foreign key constraint on member_id");
    if (this.live().some((m) => m.member_id === p.memberId && m.kind === p.kind && m.project_id === null)) return "exists";
    this.add(p.memberId, p.kind, p.achievedOn, p.createdBy);
    return "added";
  }

  async withdraw(id: string) {
    const row = this.live().find((m) => m.id === id && m.status === "proposed");
    if (!row) return false;
    row.deleted_at = new Date().toISOString();
    return true;
  }

  async answer(id: string, memberId: string, answer: MilestoneAnswer, now: Date) {
    const row = this.live().find((m) => m.id === id && m.member_id === memberId);
    if (!row) return false;
    Object.assign(row, answerColumns(answer, now.toISOString()));
    return true;
  }
}
