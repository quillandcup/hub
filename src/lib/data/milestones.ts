import { MILESTONE_DEFAULT_VISIBILITY, type ConfirmedMilestoneAnswer, type MilestoneAnswer, type MilestoneKind, type MilestoneSource, type MilestoneStatus } from "@/lib/finishers";
import { stepsCountedWhileMember, workKey, type WorkRef } from "@/lib/finishers-works";
import { isShownToMembers, visibilityOf, type Visibility } from "@/lib/writing-visibility";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId, must } from "./query";

/** A Finisher milestone a member claims or staff proposed (`member_milestones`). Withdrawing one is a soft delete. */
export type MilestoneRow = Row<"member_milestones">;

/** What the member's card shows of a milestone. */
export type Milestone = {
  id: string;
  memberId: string;
  kind: MilestoneKind;
  /** The work it is about (docs/product/FINISHERS.md): a project and/or a Bookshelf book, or neither with a title. */
  projectId: string | null;
  bookId: string | null;
  /** The name of a work that is not a project or a book, written by the member. */
  title: string | null;
  status: MilestoneStatus;
  source: MilestoneSource;
  achievedOn: string | null;
  storyBefore: string | null;
  storyAfter: string | null;
  /** Who can see it (and the story with it): only the member, other members, or the web. Only a confirmed milestone is more than private. */
  visibility: Visibility;
  /** "Share my story to inspire other writers": the one marketing consent. Only on a confirmed milestone. */
  consentTestimonial: boolean;
  confirmedAt: string | null;
  createdAt: string;
};

/** A milestone as another member or a visitor of the web sees it: no id, only what the member's level allows. */
export type ShownMilestone = {
  kind: MilestoneKind;
  /** The title the member wrote, or the book's; null for a milestone of a project (a project's name follows the project's own level). */
  workTitle: string | null;
  achievedOn: string | null;
  storyBefore: string | null;
  storyAfter: string | null;
  visibility: Visibility;
};

/** A step on a work as the strips show it: a stored milestone, or Published (derived from a Bookshelf book, always at the globe). */
export type ShownStepKind = MilestoneKind | "published";

/**
 * One row of a member's works as the strips read it: `workNo` numbers the works (1, 2, 3...) so rows of the same work can be
 * grouped without an id. `workTitle` is the work's name as the viewer may know it: the book's title or the one the member wrote,
 * the project's title when the viewer may see the project itself (its own level), else null and the strip says "Another work".
 */
export type ShownWorkStep = {
  workNo: number;
  kind: ShownStepKind;
  workTitle: string | null;
  achievedOn: string | null;
  storyBefore: string | null;
  storyAfter: string | null;
  visibility: Visibility;
};

/** A shown milestone as the Finisher and Author badges read it: no id, no work, no stories. */
export type BadgeMilestone = { memberId: string; kind: MilestoneKind; achievedOn: string | null };

/** A milestone as the staff list shows it: the member's names, never the stories. */
export type StaffMilestone = Pick<Milestone, "id" | "memberId" | "kind" | "status" | "source" | "achievedOn" | "createdAt"> & {
  /** What the milestone is about: the project's or book's title, or the title the member wrote; null for a row with no work. */
  workTitle: string | null;
  name: string;
  displayName: string | null;
};

export type MilestoneCounts = Record<MilestoneStatus, number>;

/** What the staff add by hand for one member. */
export type MilestoneProposal = {
  memberId: string;
  kind: MilestoneKind;
  /** The work: a project and/or a book, or a title. */
  work: WorkRef;
  achievedOn: string | null;
  /** The signed-in staff user (an auth user id). */
  createdBy: string;
};

const COLUMNS =
  "id, member_id, kind, project_id, book_id, title, status, source, achieved_on, story_before, story_after, visibility, consent_testimonial, confirmed_at, created_at";

type MilestoneColumns = Pick<
  MilestoneRow,
  | "id" | "member_id" | "kind" | "project_id" | "book_id" | "title" | "status" | "source" | "achieved_on" | "story_before" | "story_after"
  | "visibility" | "consent_testimonial" | "confirmed_at" | "created_at"
>;

// The check constraints hold kind, status and source to these values; the generated types see plain text.
function toMilestone(r: MilestoneColumns): Milestone {
  return {
    id: r.id,
    memberId: r.member_id,
    kind: r.kind as MilestoneKind,
    projectId: r.project_id,
    bookId: r.book_id,
    title: r.title,
    status: r.status as MilestoneStatus,
    source: r.source as MilestoneSource,
    achievedOn: r.achieved_on,
    storyBefore: r.story_before,
    storyAfter: r.story_after,
    visibility: r.visibility as Visibility,
    consentTestimonial: r.consent_testimonial,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
  };
}

type ShownColumns = { kind: string; work_title: string | null; achieved_on: string | null; story_before: string | null; story_after: string | null; visibility: string };

type WorkStepColumns = ShownColumns & { work_no: number };

function toWorkStep(r: WorkStepColumns): ShownWorkStep {
  return {
    workNo: r.work_no,
    kind: r.kind as ShownStepKind,
    workTitle: r.work_title,
    achievedOn: r.achieved_on,
    storyBefore: r.story_before,
    storyAfter: r.story_after,
    visibility: r.visibility as Visibility,
  };
}

function toShown(r: ShownColumns): ShownMilestone {
  return { kind: r.kind as MilestoneKind, workTitle: r.work_title, achievedOn: r.achieved_on, storyBefore: r.story_before, storyAfter: r.story_after, visibility: r.visibility as Visibility };
}

const STATUSES: readonly MilestoneStatus[] = ["proposed", "confirmed", "declined"];

/** What a staff backfill added: proposals, for how many members, across how many books. */
export type BackfillResult = { proposals: number; members: number; books: number };

/** What the member says when they add a milestone themselves. */
export type MilestoneSelfAdd = {
  memberId: string;
  kind: MilestoneKind;
  answer: ConfirmedMilestoneAnswer;
  /** The work: one of the member's own projects and/or books (the database refuses anyone else's), or a title. */
  work: WorkRef;
  /** The signed-in user (an auth user id). */
  createdBy: string;
  /** Where it came from: the member adding it on the card (the default), or answering the prompt when a project moved forward. */
  source?: "member" | "project_stage";
};

/** What the member says to "not yet" when a project moved forward and we asked (docs/product/FINISHERS.md, "The project-stage prompt"). */
export type MilestoneNotYet = { memberId: string; kind: MilestoneKind; projectId: string; createdBy: string };

/** The sources of a milestone the member made themselves, so they may take it back. */
const MEMBER_MADE_SOURCES: readonly string[] = ["member", "project_stage"];

/**
 * The columns an answer writes. A decline clears the consent and the level, because both only exist on a confirmed row. A
 * confirmation that names no level moves a milestone that was not confirmed before to the default (the database trigger,
 * `MILESTONE_DEFAULT_VISIBILITY`), and changing one that is already confirmed never moves it. A level the member picked is
 * written with the answer, except "private": the trigger would read a private write as "no level named", so `answer` sets it afterwards.
 */
function answerColumns(answer: MilestoneAnswer, nowIso: string) {
  if (answer.status === "declined") {
    return { status: "declined", confirmed_at: null, consent_testimonial: false, visibility: "private", updated_at: nowIso };
  }
  return {
    ...(answer.visibility && answer.visibility !== "private" ? { visibility: answer.visibility } : {}),
    status: "confirmed",
    confirmed_at: nowIso,
    achieved_on: answer.achievedOn,
    story_before: answer.storyBefore,
    story_after: answer.storyAfter,
    consent_testimonial: answer.consent_testimonial,
    updated_at: nowIso,
  };
}

/**
 * The Finisher record (`member_milestones`, docs/product/FINISHERS.md). Under a member's own client the rows are theirs alone;
 * under an admin's they are all rows, but an admin can only add proposals and edit or withdraw ones that are still
 * proposals. A member can also add their own, already confirmed, and take those back. Only live rows (`deleted_at` null) are read or changed. Every method throws on a database error.
 */
export interface MilestoneRepository {
  /** The member's own live milestones, THE END first. */
  ofMember(memberId: string): Promise<Milestone[]>;
  /** How many live milestones are in each status. */
  counts(): Promise<MilestoneCounts>;
  /** Live milestones for the staff list, newest first (then id), one page; optionally one status. */
  page(options: { status?: MilestoneStatus; limit: number; offset: number }): Promise<StaffMilestone[]>;
  /**
   * Staff backfill, per published book: proposes both milestones for that work unless the work (the book, or its project)
   * already has a row of that kind in any status, withdrawn ones included. One statement, so there is no page limit; a
   * second run adds nothing. A member with several books gets several proposals.
   */
  proposeFromBooks(): Promise<BackfillResult>;
  /** Staff add one by hand for one work of one member, as a proposal. "exists" when that work already has a live one of that kind. */
  propose(proposal: MilestoneProposal): Promise<"added" | "exists">;
  /** Staff take back a proposal the member has not answered. False when there is no such live proposal. */
  withdraw(id: string): Promise<boolean>;
  /**
   * The member adds a milestone themselves: one step, already confirmed (source `member`), with the consents they ticked.
   * When that work already has a live milestone of that kind (any status) nothing is written and that one comes back as
   * "exists", so the card can show it instead of an error. A member can have the same kind for many works.
   */
  addOwn(add: MilestoneSelfAdd, now: Date): Promise<{ result: "added" | "exists"; milestone: Milestone }>;
  /**
   * "Not yet" to the prompt when a project moved forward: a declined row for that project, source `project_stage`, which is how
   * the Hub remembers it asked (it does not ask again, and the staff backfill never proposes that kind for the work). "exists"
   * when the work already has a live milestone of that kind in any status; nothing is written then.
   */
  recordNotYet(notYet: MilestoneNotYet, now: Date): Promise<"recorded" | "exists">;
  /**
   * The kinds the member already has a row for on this project, in any status and taken-back ones too: the prompt asks once per
   * project and kind, and a member who took one back has already answered.
   */
  askedKinds(memberId: string, projectId: string): Promise<MilestoneKind[]>;
  /** The member takes back a milestone they made themselves, on the card or from the prompt (a soft delete). False when they have no such live one. */
  takeBack(id: string, memberId: string, now: Date): Promise<boolean>;
  /** The member answers (or changes their answer). False when the member has no such live milestone. */
  answer(id: string, memberId: string, answer: MilestoneAnswer, now: Date): Promise<boolean>;
  /** The member sets who can see one of their confirmed milestones. False when they have no such live confirmed one (a proposal has no level). */
  setVisibility(id: string, memberId: string, visibility: Visibility, now: Date): Promise<boolean>;
  /** The member ticks or unticks "share my story" on one of their confirmed milestones. False when they have no such live confirmed one. */
  setShareStory(id: string, memberId: string, share: boolean, now: Date): Promise<boolean>;
  /**
   * What other members see on this member's profile: their confirmed, live milestones at community or public level, with the
   * stories. Never a private one, whoever asks (an admin included); no ids.
   */
  shownToMembers(memberId: string): Promise<ShownMilestone[]>;
  /** What a visitor of the web sees on this member's writer profile: only the milestones at the globe. Service role; the page checks that the profile is on. */
  /**
   * The strip on this member's profile for other members: their works, each with its milestones at community or public level
   * and Published (derived from the live Bookshelf books, at the globe), in order. Never a private milestone, whoever asks.
   */
  worksShownToMembers(memberId: string, firstJoinedAt: string | null): Promise<ShownWorkStep[]>;
  /** The strip on the writer profile on the web: the works with their milestones at the globe and Published. Service role; the page checks the profile is on. */
  worksShownOnWeb(memberId: string, firstJoinedAt: string | null): Promise<ShownWorkStep[]>;
  /**
   * Every member's confirmed, live milestones at community or public level, for the Finisher and Author badges of many members
   * at once (kind and date only, paged past 1,000 rows). Never a private one, an admin's client included. It reads the table, so
   * it needs a staff or service client; under a member's own client it returns only their own.
   */
  allShownToMembers(): Promise<BadgeMilestone[]>;
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
      .select("id, member_id, kind, status, source, achieved_on, created_at, title, project:writing_projects(title), book:member_books(title), member:members(name, display_name)")
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
      workTitle: r.title ?? r.project?.title ?? r.book?.title ?? null,
      name: r.member?.name ?? "",
      displayName: r.member?.display_name ?? null,
    }));
  }

  async proposeFromBooks() {
    const rows = must(await this.db.rpc("propose_milestones_for_books"));
    const row = rows?.[0];
    return { proposals: row?.proposals ?? 0, members: row?.members ?? 0, books: row?.books ?? 0 };
  }

  async propose(p: MilestoneProposal) {
    const { error } = await this.db.from("member_milestones").insert({
      member_id: p.memberId,
      kind: p.kind,
      project_id: p.work.projectId,
      book_id: p.work.bookId,
      title: p.work.title,
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

  /** The member's live milestone of this kind for this work, if any (the same work key the unique index uses). */
  private async liveOfWork(memberId: string, kind: MilestoneKind, work: WorkRef) {
    const { data, error } = await this.db
      .from("member_milestones")
      .select(COLUMNS)
      .eq("member_id", memberId)
      .eq("kind", kind)
      .is("deleted_at", null)
      .order("id");
    if (error) throw new Error(error.message);
    const key = workKey(work);
    const found = (data ?? []).map(toMilestone).find((m) => workKey(m) === key);
    return found ?? null;
  }

  async addOwn(add: MilestoneSelfAdd, now: Date) {
    const existing = await this.liveOfWork(add.memberId, add.kind, add.work);
    if (existing) return { result: "exists" as const, milestone: existing };
    const { data, error } = await this.db
      .from("member_milestones")
      .insert({
        member_id: add.memberId,
        kind: add.kind,
        project_id: add.work.projectId,
        book_id: add.work.bookId,
        title: add.work.title,
        source: add.source ?? "member",
        created_by: add.createdBy,
        achieved_on: add.answer.achievedOn,
        story_before: add.answer.storyBefore,
        story_after: add.answer.storyAfter,
        status: "confirmed",
        confirmed_at: now.toISOString(),
        visibility: add.answer.visibility ?? MILESTONE_DEFAULT_VISIBILITY,
        consent_testimonial: add.answer.consent_testimonial,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        // Two taps at once: the other one won, show it.
        const winner = await this.liveOfWork(add.memberId, add.kind, add.work);
        if (winner) return { result: "exists" as const, milestone: winner };
      }
      throw new Error(error.message);
    }
    return { result: "added" as const, milestone: toMilestone(data) };
  }

  async takeBack(id: string, memberId: string, now: Date) {
    const { data, error } = await this.db
      .from("member_milestones")
      .update({ deleted_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", id)
      .eq("member_id", memberId)
      .in("source", [...MEMBER_MADE_SOURCES])
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async recordNotYet(n: MilestoneNotYet, now: Date) {
    const existing = await this.liveOfWork(n.memberId, n.kind, { projectId: n.projectId, bookId: null, title: null });
    if (existing) return "exists";
    const { error } = await this.db.from("member_milestones").insert({
      member_id: n.memberId,
      kind: n.kind,
      project_id: n.projectId,
      source: "project_stage",
      status: "declined",
      created_by: n.createdBy,
      updated_at: now.toISOString(),
    });
    if (error) {
      // Two taps at once: the other one won.
      if (error.code === "23505") return "exists";
      throw new Error(error.message);
    }
    return "recorded";
  }

  async askedKinds(memberId: string, projectId: string) {
    const { data, error } = await this.db.from("member_milestones").select("kind").eq("member_id", memberId).eq("project_id", projectId);
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((r) => r.kind as MilestoneKind))];
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
    // The trigger turns a write that names no level (private) into the default, so a member who chose "only me" gets it in a second write.
    if (data !== null && answer.status === "confirmed" && answer.visibility === "private") return this.setVisibility(id, memberId, "private", now);
    return data !== null;
  }

  async setVisibility(id: string, memberId: string, visibility: Visibility, now: Date) {
    const { data, error } = await this.db
      .from("member_milestones")
      .update({ visibility, updated_at: now.toISOString() })
      .eq("id", id)
      .eq("member_id", memberId)
      .eq("status", "confirmed")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async setShareStory(id: string, memberId: string, share: boolean, now: Date) {
    const { data, error } = await this.db
      .from("member_milestones")
      .update({ consent_testimonial: share, updated_at: now.toISOString() })
      .eq("id", id)
      .eq("member_id", memberId)
      .eq("status", "confirmed")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async shownToMembers(memberId: string) {
    return (must(await this.db.rpc("milestones_shown_to_members", { p_member_id: memberId })) ?? []).map(toShown);
  }

  async worksShownToMembers(memberId: string, firstJoinedAt: string | null) {
    return stepsCountedWhileMember((must(await this.db.rpc("member_works_shown_to_members", { p_member_id: memberId })) ?? []).map(toWorkStep), firstJoinedAt);
  }

  async worksShownOnWeb(memberId: string, firstJoinedAt: string | null) {
    return stepsCountedWhileMember((must(await this.db.rpc("member_works_shown_on_web", { p_member_id: memberId })) ?? []).map(toWorkStep), firstJoinedAt);
  }

  async allShownToMembers() {
    const rows = await fetchAllRows<{ member_id: string; kind: string; achieved_on: string | null }>((from, to) =>
      this.db
        .from("member_milestones")
        .select("member_id, kind, achieved_on")
        .eq("status", "confirmed")
        .is("deleted_at", null)
        .in("visibility", ["community", "public"])
        .order("id")
        .range(from, to),
    );
    return rows.map((r) => ({ memberId: r.member_id, kind: r.kind as MilestoneKind, achievedOn: r.achieved_on }));
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
          workTitle:
            m.title ??
            this.data.writingProjects.find((x) => x.id === m.project_id)?.title ??
            this.data.memberBooks.find((x) => x.id === m.book_id)?.title ??
            null,
          name: member?.name ?? "",
          displayName: member?.displayName ?? null,
        };
      });
  }

  private add(memberId: string, kind: MilestoneKind, work: WorkRef, achievedOn: string | null, createdBy: string | null) {
    const now = new Date().toISOString();
    this.data.memberMilestones.push({
      id: `mlst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      kind,
      project_id: work.projectId,
      book_id: work.bookId,
      title: work.title,
      achieved_on: achievedOn,
      story_before: null,
      story_after: null,
      source: "staff",
      status: "proposed",
      consent_profile: false,
      consent_homepage: false,
      consent_testimonial: false,
      visibility: "private",
      created_by: createdBy,
      confirmed_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  }

  async proposeFromBooks() {
    const books = this.data.memberBooks.filter((b) => (b.deleted_at ?? null) === null).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const members = new Set<string>();
    const booksProposed = new Set<string>();
    let proposals = 0;
    for (const book of books) {
      const projectId = book.project_id ?? null;
      for (const kind of ["the_end", "publish_ready"] as const) {
        // Any row of that kind for this work (the book, or its project), withdrawn or answered, keeps it from being proposed again.
        const taken = this.data.memberMilestones.some(
          (m) => m.member_id === book.member_id && m.kind === kind && (m.book_id === book.id || (projectId !== null && m.project_id === projectId)),
        );
        if (taken) continue;
        this.add(book.member_id, kind, { projectId, bookId: book.id, title: null }, null, null);
        members.add(book.member_id);
        booksProposed.add(book.id);
        proposals += 1;
      }
    }
    return { proposals, members: members.size, books: booksProposed.size };
  }

  private liveOfWork(memberId: string, kind: MilestoneKind, work: WorkRef) {
    const key = workKey(work);
    return this.live().find((m) => m.member_id === memberId && m.kind === kind && workKey({ projectId: m.project_id, bookId: m.book_id, title: m.title }) === key);
  }

  async propose(p: MilestoneProposal) {
    if (!this.data.members.some((m) => m.id === p.memberId)) throw new Error("violates foreign key constraint on member_id");
    if (this.liveOfWork(p.memberId, p.kind, p.work)) return "exists";
    this.add(p.memberId, p.kind, p.work, p.achievedOn, p.createdBy);
    return "added";
  }

  async withdraw(id: string) {
    const row = this.live().find((m) => m.id === id && m.status === "proposed");
    if (!row) return false;
    row.deleted_at = new Date().toISOString();
    return true;
  }

  async addOwn(add: MilestoneSelfAdd, now: Date) {
    if (!this.data.members.some((m) => m.id === add.memberId)) throw new Error("violates foreign key constraint on member_id");
    const { projectId, bookId } = add.work;
    // What the insert policy checks: the project and the book are the member's own and live.
    if (projectId !== null && !this.data.writingProjects.some((p) => p.id === projectId && p.member_id === add.memberId && !p.deleted_at)) {
      throw new Error("new row violates row-level security policy for table member_milestones");
    }
    if (bookId !== null && !this.data.memberBooks.some((b) => b.id === bookId && b.member_id === add.memberId && (b.deleted_at ?? null) === null)) {
      throw new Error("new row violates row-level security policy for table member_milestones");
    }
    const existing = this.liveOfWork(add.memberId, add.kind, add.work);
    if (existing) return { result: "exists" as const, milestone: toMilestone(existing) };
    const iso = now.toISOString();
    const row: MilestoneRow = {
      id: `mlst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: add.memberId,
      kind: add.kind,
      project_id: projectId,
      book_id: bookId,
      title: add.work.title,
      achieved_on: add.answer.achievedOn,
      story_before: add.answer.storyBefore,
      story_after: add.answer.storyAfter,
      source: add.source ?? "member",
      status: "confirmed",
      consent_profile: false,
      consent_homepage: false,
      consent_testimonial: add.answer.consent_testimonial,
      visibility: add.answer.visibility ?? MILESTONE_DEFAULT_VISIBILITY,
      created_by: add.createdBy,
      confirmed_at: iso,
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    };
    this.data.memberMilestones.push(row);
    return { result: "added" as const, milestone: toMilestone(row) };
  }

  async takeBack(id: string, memberId: string, now: Date) {
    const row = this.live().find((m) => m.id === id && m.member_id === memberId && MEMBER_MADE_SOURCES.includes(m.source));
    if (!row) return false;
    row.deleted_at = now.toISOString();
    return true;
  }

  async recordNotYet(n: MilestoneNotYet, now: Date) {
    if (!this.data.members.some((m) => m.id === n.memberId)) throw new Error("violates foreign key constraint on member_id");
    // What the insert policy checks: the project is the member's own and live.
    if (!this.data.writingProjects.some((p) => p.id === n.projectId && p.member_id === n.memberId && !p.deleted_at)) {
      throw new Error("new row violates row-level security policy for table member_milestones");
    }
    if (this.liveOfWork(n.memberId, n.kind, { projectId: n.projectId, bookId: null, title: null })) return "exists";
    const iso = now.toISOString();
    this.data.memberMilestones.push({
      id: `mlst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: n.memberId,
      kind: n.kind,
      project_id: n.projectId,
      book_id: null,
      title: null,
      achieved_on: null,
      story_before: null,
      story_after: null,
      source: "project_stage",
      status: "declined",
      consent_profile: false,
      consent_homepage: false,
      consent_testimonial: false,
      visibility: "private",
      created_by: n.createdBy,
      confirmed_at: null,
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    });
    return "recorded" as const;
  }

  async askedKinds(memberId: string, projectId: string) {
    return [...new Set(this.data.memberMilestones.filter((m) => m.member_id === memberId && m.project_id === projectId).map((m) => m.kind as MilestoneKind))];
  }

  async answer(id: string, memberId: string, answer: MilestoneAnswer, now: Date) {
    const row = this.live().find((m) => m.id === id && m.member_id === memberId);
    if (!row) return false;
    const wasConfirmed = row.status === "confirmed";
    Object.assign(row, answerColumns(answer, now.toISOString()));
    // The database trigger: a milestone confirmed for the first time that names no level starts at the default (the globe); one already
    // confirmed keeps its level. A level the member picked wins, "private" included (the Supabase repository writes it in a second step).
    if (answer.status === "confirmed") {
      if (answer.visibility) row.visibility = answer.visibility;
      else if (!wasConfirmed && row.visibility === "private") row.visibility = MILESTONE_DEFAULT_VISIBILITY;
    }
    return true;
  }

  private confirmedOf(id: string, memberId: string) {
    return this.live().find((m) => m.id === id && m.member_id === memberId && m.status === "confirmed");
  }

  async setVisibility(id: string, memberId: string, visibility: Visibility, now: Date) {
    const row = this.confirmedOf(id, memberId);
    if (!row) return false;
    row.visibility = visibility;
    row.updated_at = now.toISOString();
    return true;
  }

  async setShareStory(id: string, memberId: string, share: boolean, now: Date) {
    const row = this.confirmedOf(id, memberId);
    if (!row) return false;
    row.consent_testimonial = share;
    row.updated_at = now.toISOString();
    return true;
  }

  private shown(memberId: string, levels: readonly string[]): ShownMilestone[] {
    return this.live()
      .filter((m) => m.member_id === memberId && m.status === "confirmed" && levels.includes(m.visibility))
      .sort(byKeyThenId<MilestoneRow>((m) => m.kind, (m) => m.id, true))
      .map((m) => ({
        kind: m.kind as MilestoneKind,
        workTitle: m.title ?? this.data.memberBooks.find((b) => b.id === m.book_id && (b.deleted_at ?? null) === null)?.title ?? null,
        achievedOn: m.achieved_on,
        storyBefore: m.story_before,
        storyAfter: m.story_after,
        visibility: m.visibility as Visibility,
      }));
  }

  async shownToMembers(memberId: string) {
    return this.shown(memberId, ["community", "public"]);
  }

  /** The same grouping as `member_works_shown`: works keyed by project, else book, else title; Published per live book; numbered by first row. */
  private works(memberId: string, levels: readonly string[]): ShownWorkStep[] {
    const books = this.data.memberBooks.filter((b) => (b.deleted_at ?? null) === null);
    type Item = ShownWorkStep & { key: string; step: number; createdAt: string; titleRank: number };
    const items: Item[] = [];
    for (const m of this.live()) {
      if (m.member_id !== memberId || m.status !== "confirmed" || !levels.includes(m.visibility)) continue;
      const book = m.book_id ? books.find((b) => b.id === m.book_id) : undefined;
      // The project's title counts only when the viewer may see the project itself: its own level is one this read serves.
      const project = this.data.writingProjects.find((p) => p.id === (m.project_id ?? book?.project_id) && !p.deleted_at && levels.includes(visibilityOf(p)));
      items.push({
        key: book?.project_id ?? m.project_id ?? m.book_id ?? workKey({ projectId: null, bookId: null, title: m.title }),
        step: m.kind === "the_end" ? 1 : 2,
        createdAt: m.created_at,
        titleRank: m.title !== null ? 1 : book?.title ? 2 : 3,
        workNo: 0,
        kind: m.kind as MilestoneKind,
        workTitle: m.title ?? book?.title ?? project?.title ?? null,
        achievedOn: m.achieved_on,
        storyBefore: m.story_before,
        storyAfter: m.story_after,
        visibility: m.visibility as Visibility,
      });
    }
    for (const b of books.filter((x) => x.member_id === memberId)) {
      items.push({ key: b.project_id ?? b.id, step: 3, createdAt: b.created_at ?? "", titleRank: 2, workNo: 0, kind: "published", workTitle: b.title, achievedOn: b.published_date ?? null, storyBefore: null, storyAfter: null, visibility: "public" });
    }
    const first = new Map<string, string>();
    for (const i of items) if (!first.has(i.key) || i.createdAt < first.get(i.key)!) first.set(i.key, i.createdAt);
    // The work's name: the first title by rank (the member's own, the book's, the project's), then by age, as the SQL window reads it.
    const title = new Map<string, string | null>();
    for (const key of first.keys()) {
      const named = items.filter((i) => i.key === key && i.workTitle !== null).sort((a, b) => a.titleRank - b.titleRank || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      title.set(key, named[0]?.workTitle ?? null);
    }
    const order = [...first.keys()].sort((a, b) => (first.get(a)! < first.get(b)! ? -1 : first.get(a)! > first.get(b)! ? 1 : a < b ? -1 : a > b ? 1 : 0));
    return items
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key) || a.step - b.step || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(({ key, step: _step, createdAt: _createdAt, titleRank: _titleRank, ...rest }) => ({ ...rest, workNo: order.indexOf(key) + 1, workTitle: title.get(key) ?? null }));
  }

  async worksShownToMembers(memberId: string, firstJoinedAt: string | null) {
    return stepsCountedWhileMember(this.works(memberId, ["community", "public"]), firstJoinedAt);
  }

  async worksShownOnWeb(memberId: string, firstJoinedAt: string | null) {
    return stepsCountedWhileMember(this.works(memberId, ["public"]), firstJoinedAt);
  }

  async allShownToMembers() {
    return this.live()
      .filter((m) => m.status === "confirmed" && isShownToMembers(m.visibility as Visibility))
      .sort(byKeyThenId<MilestoneRow>((m) => m.id, (m) => m.id))
      .map((m) => ({ memberId: m.member_id, kind: m.kind as MilestoneKind, achievedOn: m.achieved_on }));
  }
}
