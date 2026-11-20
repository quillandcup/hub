import { beforeEach, describe, expect, it } from "vitest";
import type { MilestoneRepository } from "@/lib/data/milestones";
import { parseMilestoneAnswer, type MilestoneAnswer } from "@/lib/finishers";

export type MilestonesContractContext = {
  repo: () => MilestoneRepository;
  /** Two members: "Ada Example" (no books) and "Bo Example" (no books). */
  members: readonly string[];
  /** A member id nothing has. */
  missingMemberId: string;
  /** An auth user id to record as the staff member who proposes. */
  staffUserId: string;
  /** Gives a member one live (not deleted) published book. */
  addBook: (memberId: string) => Promise<void>;
  /** Soft-deletes every book of the member. */
  deleteBooks: (memberId: string) => Promise<void>;
  /** Removes every milestone and book stored for the two members. */
  clear: () => Promise<void>;
};

const NOW = new Date("2026-11-20T15:00:00Z");
const confirmed = (extra: Partial<Parameters<typeof parseMilestoneAnswer>[0]> = {}) => {
  const answer = parseMilestoneAnswer({ answer: "confirm", ...extra }, NOW.getTime());
  if ("error" in answer) throw new Error(answer.error);
  return answer;
};

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
    const proposal = (i: number, kind: "the_end" | "publish_ready" = "the_end") => ({ memberId: id(i), kind, achievedOn: null, createdBy: ctx.staffUserId });

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
        consentProfile: false,
        consentHomepage: false,
        consentTestimonial: false,
        storyBefore: null,
        achievedOn: null,
      });
      expect(await repo.ofMember(id(bo))).toEqual([]);
    });

    it("refuses a proposal for a member that does not exist", async () => {
      await expect(ctx.repo().propose({ ...proposal(ada), memberId: ctx.missingMemberId })).rejects.toThrow();
    });

    it("confirms with a date, stories and only the consents ticked", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      const ok = await repo.answer(
        row.id,
        id(ada),
        confirmed({ achievedOn: "2026-05-01", storyBefore: "Stuck in chapter two.", storyAfter: "Done.", consents: { consent_profile: true } }),
        NOW,
      );
      expect(ok).toBe(true);
      const [after] = await repo.ofMember(id(ada));
      expect(after).toMatchObject({
        status: "confirmed",
        achievedOn: "2026-05-01",
        storyBefore: "Stuck in chapter two.",
        storyAfter: "Done.",
        consentProfile: true,
        consentHomepage: false,
        consentTestimonial: false,
      });
      expect(after.confirmedAt).not.toBeNull();
    });

    it("declines, which drops every consent, and lets the member change their mind", async () => {
      const repo = ctx.repo();
      await repo.propose(proposal(ada));
      const [row] = await repo.ofMember(id(ada));
      await repo.answer(row.id, id(ada), confirmed({ consents: { consent_homepage: true, consent_testimonial: true } }), NOW);
      const decline: MilestoneAnswer = { status: "declined" };
      expect(await repo.answer(row.id, id(ada), decline, NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ status: "declined", confirmedAt: null, consentHomepage: false, consentTestimonial: false });
      expect(await repo.answer(row.id, id(ada), confirmed(), NOW)).toBe(true);
      expect((await repo.ofMember(id(ada)))[0].status).toBe("confirmed");
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
      expect(added).toBeGreaterThanOrEqual(2);
      const mine = await repo.ofMember(id(ada));
      expect(mine.map((m) => [m.kind, m.status, m.source])).toEqual([
        ["the_end", "proposed", "staff"],
        ["publish_ready", "proposed", "staff"],
      ]);
      expect(await repo.ofMember(id(bo))).toEqual([]);
      expect(await repo.proposeFromBooks()).toBe(0);
      expect(await repo.ofMember(id(ada))).toHaveLength(2);
    });

    it("keeps a member's answer or withdrawal through a later backfill, and ignores a deleted book", async () => {
      const repo = ctx.repo();
      await ctx.addBook(id(ada));
      await repo.proposeFromBooks();
      const [theEnd, ready] = await repo.ofMember(id(ada));
      await repo.answer(theEnd.id, id(ada), { status: "declined" }, NOW);
      await repo.withdraw(ready.id);
      expect(await repo.proposeFromBooks()).toBe(0);
      expect(await repo.ofMember(id(ada))).toHaveLength(1);
      expect((await repo.ofMember(id(ada)))[0].status).toBe("declined");

      await ctx.deleteBooks(id(ada));
      await ctx.addBook(id(bo));
      await ctx.deleteBooks(id(bo));
      await repo.proposeFromBooks();
      expect(await repo.ofMember(id(bo))).toEqual([]);
    });
  });
}
