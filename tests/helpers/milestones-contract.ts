import { beforeEach, describe, expect, it } from "vitest";
import type { MilestoneRepository } from "@/lib/data/milestones";
import { parseMilestoneAnswer, type MilestoneAnswer } from "@/lib/finishers";
import { workKey, type WorkRef } from "@/lib/finishers-works";

export type MilestonesContractContext = {
  repo: () => MilestoneRepository;
  /** Two members: "Ada Example" (no books) and "Bo Example" (no books). */
  members: readonly string[];
  /** A member id nothing has. */
  missingMemberId: string;
  /** An auth user id to record as the staff member who proposes. */
  staffUserId: string;
  /** Gives a member one live (not deleted) published book, optionally linked to one of their projects, and returns its id. */
  addBook: (memberId: string, projectId?: string) => Promise<string>;
  /** Soft-deletes every book of the member. */
  deleteBooks: (memberId: string) => Promise<void>;
  /** Gives a member one live writing project and returns its id. */
  addProject: (memberId: string) => Promise<string>;
  /** Removes every milestone, book and project stored for the two members. */
  clear: () => Promise<void>;
};

const NOW = new Date("2026-11-20T15:00:00Z");
/** The work most tests use: one the member names by title. */
const WORK: WorkRef = { projectId: null, bookId: null, title: "A Fake Novel" };
const ownAdd = (memberId: string, createdBy: string, kind: "the_end" | "publish_ready" = "the_end", extra: Partial<Parameters<typeof parseMilestoneAnswer>[0]> = {}, work: WorkRef = WORK) => ({
  memberId,
  kind,
  work,
  createdBy,
  answer: confirmed(extra),
});
function confirmed(extra: Partial<Parameters<typeof parseMilestoneAnswer>[0]> = {}) {
  const answer = parseMilestoneAnswer({ answer: "confirm", ...extra }, NOW.getTime());
  if ("error" in answer || answer.status !== "confirmed") throw new Error("error" in answer ? answer.error : "not confirmed");
  return answer;
}

/** Behavior every `MilestoneRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMilestonesContract(name: string, setup: () => MilestonesContractContext) {
  // The database runs each statement through PostgREST, and a backfill walks every member's books: allow for a slow stack.
  describe(`${name} (MilestoneRepository contract)`, { timeout: 60_000 }, () => {
    let ctx: MilestonesContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    }, 60_000);
    const [ada, bo] = [0, 1];
    const id = (i: number) => ctx.members[i];
    const proposal = (i: number, kind: "the_end" | "publish_ready" = "the_end", work: WorkRef = WORK) => ({ memberId: id(i), kind, work, achievedOn: null, createdBy: ctx.staffUserId });

    it("adds a proposal by hand, hidden as proposed with every consent off, and says when it already exists", async () => {
      const repo = ctx.repo();
      expect(await repo.propose(proposal(ada))).toBe("added");
      expect(await repo.propose(proposal(ada))).toBe("exists");
      expect(await repo.propose(proposal(ada, "publish_ready"))).toBe("added");
      const mine = await repo.ofMember(id(ada));
      expect(mine.map((m) => m.kind)).toEqual(["the_end", "publish_ready"]);
      expect(mine[0]).toMatchObject({
        status: "proposed",
        source: "staff",
        confirmedAt: null,
        visibility: "private",
        consentTestimonial: false,
        storyBefore: null,
        achievedOn: null,
      });
      expect(await repo.ofMember(id(bo))).toEqual([]);
    });

    it("refuses a proposal for a member that does not exist", async () => {
      await expect(ctx.repo().propose({ ...proposal(ada), memberId: ctx.missingMemberId })).rejects.toThrow();
    });

    it("confirms with a date, stories and the share consent when ticked, and starts at 'other members can see it'", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      const ok = await repo.answer(
        row.id,
        id(ada),
        confirmed({ achievedOn: "2026-05-01", storyBefore: "Stuck in chapter two.", storyAfter: "Done.", shareStory: true }),
        NOW,
      );
      expect(ok).toBe(true);
      const [after] = await repo.ofMember(id(ada));
      expect(after).toMatchObject({
        status: "confirmed",
        achievedOn: "2026-05-01",
        storyBefore: "Stuck in chapter two.",
        storyAfter: "Done.",
        visibility: "community",
        consentTestimonial: true,
      });
      expect(after.confirmedAt).not.toBeNull();
    });

    it("declines, which drops the consent and the level, and lets the member change their mind", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      await repo.answer(row.id, id(ada), confirmed({ storyAfter: "Done.", shareStory: true }), NOW);
      await repo.setVisibility(row.id, id(ada), "public", NOW);
      const decline: MilestoneAnswer = { status: "declined" };
      expect(await repo.answer(row.id, id(ada), decline, NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ status: "declined", confirmedAt: null, visibility: "private", consentTestimonial: false });
      expect(await repo.answer(row.id, id(ada), confirmed(), NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ status: "confirmed", visibility: "community" });
    });

    it("keeps the level the member chose when they change a confirmed answer", async () => {
      const repo = ctx.repo();
      const { milestone } = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId), NOW);
      expect(milestone.visibility).toBe("community");
      expect(await repo.setVisibility(milestone.id, id(ada), "private", NOW)).toBe(true);
      expect(await repo.answer(milestone.id, id(ada), confirmed({ storyAfter: "Done." }), NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ visibility: "private", storyAfter: "Done." });
    });

    it("lets only the owner answer a milestone", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      expect(await repo.answer(row.id, id(bo), confirmed(), NOW)).toBe(false);
      expect((await repo.ofMember(id(ada)))[0].status).toBe("proposed");
    });

    it("withdraws a proposal, but not one the member answered", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      await repo.propose(proposal(ada, "publish_ready"));
      const [theEnd, ready] = await repo.ofMember(id(ada));
      await repo.answer(ready.id, id(ada), confirmed(), NOW);
      expect(await repo.withdraw(ready.id)).toBe(false);
      expect(await repo.withdraw(theEnd.id)).toBe(true);
      expect(await repo.withdraw(theEnd.id)).toBe(false);
      expect((await repo.ofMember(id(ada))).map((m) => m.kind)).toEqual(["publish_ready"]);
      // A withdrawn row frees the slot for a new proposal by hand.
      expect(await repo.propose(proposal(ada))).toBe("added");
    });

    it("counts live milestones by status and pages the staff list newest first", async () => {
      const repo = ctx.repo();
      const before = await repo.counts();
      await repo.propose(proposal(ada));
      await repo.propose(proposal(ada, "publish_ready"));
      await repo.propose(proposal(bo));
      const [first] = await repo.ofMember(id(ada));
      await repo.answer(first.id, id(ada), confirmed(), NOW);
      const [boRow] = await repo.ofMember(id(bo));
      await repo.answer(boRow.id, id(bo), { status: "declined" }, NOW);
      const after = await repo.counts();
      expect(after.proposed - before.proposed).toBe(1);
      expect(after.confirmed - before.confirmed).toBe(1);
      expect(after.declined - before.declined).toBe(1);

      const declined = await repo.page({ status: "declined", limit: 1000, offset: 0 });
      const mine = declined.find((m) => m.id === boRow.id);
      expect(mine).toMatchObject({ memberId: id(bo), kind: "the_end", status: "declined", name: expect.any(String) });
      expect(mine).not.toHaveProperty("storyBefore");
      const all = await repo.page({ limit: 1000, offset: 0 });
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(await repo.page({ limit: 1, offset: 0 })).toHaveLength(1);
    });

    it("backfills both milestones for members with a book, and a second run adds nothing", async () => {
      const repo = ctx.repo();
      await ctx.addBook(id(ada));
      const added = await repo.proposeFromBooks();
      expect(added.proposals).toBeGreaterThanOrEqual(2);
      const mine = await repo.ofMember(id(ada));
      expect(mine.map((m) => [m.kind, m.status, m.source])).toEqual([
        ["the_end", "proposed", "staff"],
        ["publish_ready", "proposed", "staff"],
      ]);
      expect(await repo.ofMember(id(bo))).toEqual([]);
      expect((await repo.proposeFromBooks()).proposals).toBe(0);
      expect(await repo.ofMember(id(ada))).toHaveLength(2);
    });

    it("keeps a member's answer or withdrawal through a later backfill, and ignores a deleted book", async () => {
      const repo = ctx.repo();
      await ctx.addBook(id(ada));
      await repo.proposeFromBooks();
      const [theEnd, ready] = await repo.ofMember(id(ada));
      await repo.answer(theEnd.id, id(ada), { status: "declined" }, NOW);
      await repo.withdraw(ready.id);
      expect((await repo.proposeFromBooks()).proposals).toBe(0);
      expect(await repo.ofMember(id(ada))).toHaveLength(1);
      expect((await repo.ofMember(id(ada)))[0].status).toBe("declined");

      await ctx.deleteBooks(id(ada));
      await ctx.addBook(id(bo));
      await ctx.deleteBooks(id(bo));
      await repo.proposeFromBooks();
      expect(await repo.ofMember(id(bo))).toEqual([]);
    });

    it("proposes per book: several books give several proposals, a book that is its project's work counts once, and a second run adds nothing", async () => {
      const repo = ctx.repo();
      const projectId = await ctx.addProject(id(ada));
      const linkedBook = await ctx.addBook(id(ada), projectId);
      const otherBook = await ctx.addBook(id(ada));
      await ctx.addBook(id(bo));
      const first = await repo.proposeFromBooks();
      expect(first.proposals).toBeGreaterThanOrEqual(6);
      expect(first.members).toBeGreaterThanOrEqual(2);
      expect(first.books).toBeGreaterThanOrEqual(3);
      const mine = await repo.ofMember(id(ada));
      expect(mine).toHaveLength(4);
      expect(mine.filter((m) => m.bookId === linkedBook).every((m) => m.projectId === projectId)).toBe(true);
      expect(mine.filter((m) => m.bookId === otherBook).map((m) => m.kind).sort()).toEqual(["publish_ready", "the_end"]);
      expect(await repo.ofMember(id(bo))).toHaveLength(2);
      expect(await repo.proposeFromBooks()).toEqual({ proposals: 0, members: 0, books: 0 });
    });

    it("skips a book whose project already has the milestone, in any status, and proposes the other kind", async () => {
      const repo = ctx.repo();
      const projectId = await ctx.addProject(id(ada));
      const book = await ctx.addBook(id(ada), projectId);
      await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId, bookId: null, title: null }), NOW);
      await repo.proposeFromBooks();
      const mine = await repo.ofMember(id(ada));
      expect(mine.map((m) => [m.kind, m.source, m.bookId])).toEqual([
        ["the_end", "member", null],
        ["publish_ready", "staff", book],
      ]);
    });

    it("lets a member have the same kind for many works, and one row per work", async () => {
      const repo = ctx.repo();
      const projectId = await ctx.addProject(id(ada));
      const bookId = await ctx.addBook(id(ada));
      const a = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId, bookId: null, title: null }), NOW);
      const b = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId: null, bookId, title: null }), NOW);
      const c = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId: null, bookId: null, title: "Another Fake Work" }), NOW);
      expect([a.result, b.result, c.result]).toEqual(["added", "added", "added"]);
      expect(await repo.ofMember(id(ada))).toHaveLength(3);
      // The same work again, however it is named, shows the existing one: a title is the same work in any case and spacing.
      const again = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId: null, bookId: null, title: "another fake work" }), NOW);
      expect(again).toMatchObject({ result: "exists", milestone: { id: c.milestone.id } });
      expect((await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId, bookId: null, title: null }), NOW)).result).toBe("exists");
      // The other kind for the same work is its own row.
      expect((await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "publish_ready", {}, { projectId, bookId: null, title: null }), NOW)).result).toBe("added");
      expect(workKey(c.milestone)).toBe("title:another fake work");
      expect(await repo.ofMember(id(ada))).toHaveLength(4);
    });

    it("lets staff propose per work, and says when that work already has it", async () => {
      const repo = ctx.repo();
      const projectId = await ctx.addProject(id(ada));
      expect(await repo.propose(proposal(ada, "the_end", { projectId, bookId: null, title: null }))).toBe("added");
      expect(await repo.propose(proposal(ada, "the_end", { projectId, bookId: null, title: null }))).toBe("exists");
      expect(await repo.propose(proposal(ada, "the_end", { projectId: null, bookId: null, title: "A Second Fake Work" }))).toBe("added");
      const page = await repo.page({ limit: 1000, offset: 0 });
      expect(page.filter((m) => m.memberId === id(ada)).map((m) => m.workTitle).sort()).toEqual(["A Fake Novel", "A Second Fake Work"].sort());
    });

    it("lets a member add their own milestone: confirmed in one step, source member, with the date, stories and ticks they chose", async () => {
      const repo = ctx.repo();
      const out = await repo.addOwn(
        ownAdd(id(ada), ctx.staffUserId, "the_end", { achievedOn: "2026-05-01", storyAfter: "Done.", shareStory: true }),
        NOW,
      );
      expect(out.result).toBe("added");
      expect(out.milestone).toMatchObject({
        memberId: id(ada),
        kind: "the_end",
        status: "confirmed",
        source: "member",
        projectId: null,
        bookId: null,
        title: "A Fake Novel",
        achievedOn: "2026-05-01",
        storyBefore: null,
        storyAfter: "Done.",
        visibility: "community",
        consentTestimonial: true,
      });
      expect(out.milestone.confirmedAt).not.toBeNull();
      expect(await repo.ofMember(id(ada))).toEqual([out.milestone]);
      expect(await repo.ofMember(id(bo))).toEqual([]);
    });

    it("adds with the share consent off when it is not ticked, and links one of the member's projects", async () => {
      const repo = ctx.repo();
      const projectId = await ctx.addProject(id(ada));
      const { milestone } = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "publish_ready", {}, { projectId, bookId: null, title: null }), NOW);
      expect(milestone).toMatchObject({ kind: "publish_ready", projectId, title: null, visibility: "community", consentTestimonial: false });
    });

    it("shows the existing one instead of adding a second, whoever started it", async () => {
      const repo = ctx.repo();
      const first = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId), NOW);
      const again = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", { storyAfter: "Different" }), NOW);
      expect(again.result).toBe("exists");
      expect(again.milestone.id).toBe(first.milestone.id);
      expect(again.milestone.storyAfter).toBeNull();

      await repo.propose(proposal(bo));
      const [proposed] = await repo.ofMember(id(bo));
      const onTop = await repo.addOwn(ownAdd(id(bo), ctx.staffUserId), NOW);
      expect(onTop).toMatchObject({ result: "exists", milestone: { id: proposed.id, status: "proposed", source: "staff" } });
      expect(await repo.ofMember(id(bo))).toHaveLength(1);

      // Another work is another row.
      const projectId = await ctx.addProject(id(ada));
      expect((await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId, bookId: null, title: null }), NOW)).result).toBe("added");
      expect(await repo.ofMember(id(ada))).toHaveLength(2);
    });

    it("takes back a milestone the member added (a soft delete that frees the slot), but only theirs", async () => {
      const repo = ctx.repo();
      const { milestone } = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId), NOW);
      expect(await repo.takeBack(milestone.id, id(bo), NOW)).toBe(false);
      expect(await repo.takeBack(milestone.id, id(ada), NOW)).toBe(true);
      expect(await repo.takeBack(milestone.id, id(ada), NOW)).toBe(false);
      expect(await repo.ofMember(id(ada))).toEqual([]);
      const again = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId), NOW);
      expect(again.result).toBe("added");
      expect(again.milestone.id).not.toBe(milestone.id);
    });

    it("does not let a member take back what staff proposed: they answer it instead", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      expect(await repo.takeBack(row.id, id(ada), NOW)).toBe(false);
      expect(await repo.ofMember(id(ada))).toHaveLength(1);
    });

    it("lets the member change what they added, and the staff backfill skips a kind they already have (even one they took back)", async () => {
      const repo = ctx.repo();
      const bookId = await ctx.addBook(id(ada));
      const { milestone } = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", {}, { projectId: null, bookId, title: null }), NOW);
      expect(await repo.answer(milestone.id, id(ada), confirmed({ storyBefore: "Stuck.", shareStory: true }), NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ source: "member", status: "confirmed", storyBefore: "Stuck.", consentTestimonial: true });

      await repo.proposeFromBooks();
      expect((await repo.ofMember(id(ada))).map((m) => [m.kind, m.status, m.source])).toEqual([
        ["the_end", "confirmed", "member"],
        ["publish_ready", "proposed", "staff"],
      ]);

      await repo.takeBack(milestone.id, id(ada), NOW);
      expect((await repo.proposeFromBooks()).proposals).toBe(0);
      expect((await repo.ofMember(id(ada))).map((m) => m.kind)).toEqual(["publish_ready"]);
    });

    it("sets who sees a confirmed milestone, only for its owner and never for a proposal", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [proposed] = await repo.ofMember(id(ada));
      // A proposal has no level: it stays private until the member confirms it.
      expect(await repo.setVisibility(proposed.id, id(ada), "community", NOW)).toBe(false);
      expect((await repo.ofMember(id(ada)))[0].visibility).toBe("private");

      await repo.answer(proposed.id, id(ada), confirmed(), NOW);
      expect(await repo.setVisibility(proposed.id, id(bo), "public", NOW)).toBe(false);
      expect(await repo.setVisibility(proposed.id, id(ada), "public", NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0].visibility).toBe("public");
      expect(await repo.setVisibility(proposed.id, id(ada), "private", NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0].visibility).toBe("private");

      const own = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "publish_ready"), NOW);
      await repo.takeBack(own.milestone.id, id(ada), NOW);
      expect(await repo.setVisibility(own.milestone.id, id(ada), "community", NOW)).toBe(false);
    });

    it("ticks and unticks the share consent on a confirmed milestone, only for its owner", async () => {
      const repo = ctx.repo();
      const { milestone } = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", { storyAfter: "Done." }), NOW);
      expect(milestone.consentTestimonial).toBe(false);
      expect(await repo.setShareStory(milestone.id, id(bo), true, NOW)).toBe(false);
      expect(await repo.setShareStory(milestone.id, id(ada), true, NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0].consentTestimonial).toBe(true);
      expect(await repo.setShareStory(milestone.id, id(ada), false, NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0].consentTestimonial).toBe(false);

      // No consent on a proposal: the database refuses it, so the repository says no.
      await repo.propose(proposal(ada, "publish_ready"));
      const proposed = (await repo.ofMember(id(ada))).find((m) => m.kind === "publish_ready")!;
      expect(await repo.setShareStory(proposed.id, id(ada), true, NOW)).toBe(false);
    });

    it("shows other members only confirmed milestones at community or public, and the web only the globe", async () => {
      const repo = ctx.repo();
      const bookId = await ctx.addBook(id(ada));
      const community = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", { achievedOn: "2026-05-01", storyAfter: "Done." }, { projectId: null, bookId, title: null }), NOW);
      const globe = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "publish_ready", { storyBefore: "Stuck." }, { projectId: null, bookId: null, title: "A Second Fake Work" }), NOW);
      const hidden = await repo.addOwn(ownAdd(id(ada), ctx.staffUserId, "the_end", { storyAfter: "Secret words." }, { projectId: null, bookId: null, title: "A Private Fake Work" }), NOW);
      await repo.propose(proposal(ada, "publish_ready", { projectId: null, bookId: null, title: "A Proposed Fake Work" }));
      await repo.setVisibility(globe.milestone.id, id(ada), "public", NOW);
      await repo.setVisibility(hidden.milestone.id, id(ada), "private", NOW);
      expect(community.milestone.visibility).toBe("community");

      const toMembers = await repo.shownToMembers(id(ada));
      expect(toMembers.map((m) => [m.kind, m.workTitle, m.visibility])).toEqual([
        ["the_end", "A Book", "community"],
        ["publish_ready", "A Second Fake Work", "public"],
      ]);
      expect(toMembers[0]).toEqual({ kind: "the_end", workTitle: "A Book", achievedOn: "2026-05-01", storyBefore: null, storyAfter: "Done.", visibility: "community" });
      // Nothing private, nothing proposed, and no ids anywhere.
      expect(JSON.stringify(toMembers)).not.toMatch(/Secret words|A Private Fake Work|A Proposed Fake Work|mlst_/);

      const onWeb = await repo.shownOnWeb(id(ada));
      expect(onWeb.map((m) => [m.kind, m.workTitle])).toEqual([["publish_ready", "A Second Fake Work"]]);
      expect(await repo.shownToMembers(id(bo))).toEqual([]);
      expect(await repo.shownOnWeb(id(bo))).toEqual([]);

      // A taken-back milestone leaves both.
      await repo.takeBack(globe.milestone.id, id(ada), NOW);
      expect(await repo.shownOnWeb(id(ada))).toEqual([]);
      expect((await repo.shownToMembers(id(ada))).map((m) => m.kind)).toEqual(["the_end"]);
    });
  });
}
