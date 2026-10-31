import { describe, it, expect, beforeEach } from "vitest";
import type { MentorshipRepository } from "@/lib/data/mentorship";

export type MentorshipContractContext = {
  repo: () => MentorshipRepository;
  /** Four members: "Ada Example" (display name "Ada E."), "Bo Example", "Cy Example" and "Dee Example". */
  members: readonly { id: string; name: string }[];
  /** A row id nothing has. */
  missingId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** Removes everything stored for the four members. */
  clear: () => Promise<void>;
};

/** Behavior every `MentorshipRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMentorshipContract(name: string, setup: () => MentorshipContractContext) {
  describe(`${name} (MentorshipRepository contract)`, () => {
    let ctx: MentorshipContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy, dee] = [0, 1, 2, 3];
    const id = (i: number) => ctx.members[i].id;

    describe("matches", () => {
      it("records a match and lists it, newest start first, with both members joined in", async () => {
        const repo = ctx.repo();
        expect(await repo.create({ mentor_member_id: id(ada), new_member_id: id(bo), started_on: "2026-01-10", kind: "direct" })).toEqual({ ok: true });
        expect(await repo.create({ mentor_member_id: id(ada), new_member_id: id(cy), started_on: "2026-03-05", trial_ends_on: "2026-03-12", kind: "trial" })).toEqual({ ok: true });

        const ours = (await repo.listWithMembers()).filter((m) => m.mentor_member_id === id(ada));
        expect(ours.map((m) => m.new_member_id)).toEqual([id(cy), id(bo)]);
        expect(ours[0]).toMatchObject({ started_on: "2026-03-05", trial_ends_on: "2026-03-12", kind: "trial", status: "matched", outcome_note: null });
        expect(ours[1]).toMatchObject({ trial_ends_on: null, kind: "direct" });
        expect(ours[0].mentor).toMatchObject({ id: id(ada), name: ctx.members[ada].name, display_name: "Ada E.", status: "active" });
        expect(ours[0].new_member).toMatchObject({ id: id(cy), name: ctx.members[cy].name, display_name: null });
        expect(ours[0].new_member).toHaveProperty("first_joined_at");
        expect(ours[0].new_member).toHaveProperty("most_recent_joined_at");
        expect(new Set((await repo.listWithMembers()).map((m) => m.id)).size).toBe((await repo.listWithMembers()).length);
      });

      it("allows one live match per arrival, but a reassigned one frees it", async () => {
        const repo = ctx.repo();
        const match = { new_member_id: id(bo), started_on: "2026-02-01", kind: "direct" };
        await repo.create({ ...match, mentor_member_id: id(ada) });
        expect(await repo.create({ ...match, mentor_member_id: id(cy) })).toEqual({ ok: false, reason: "already_matched" });
        // Another start for the same member is another arrival.
        expect(await repo.create({ ...match, started_on: "2026-06-01", mentor_member_id: id(cy) })).toEqual({ ok: true });

        const first = (await repo.listWithMembers()).find((m) => m.mentor_member_id === id(ada))!;
        expect(await repo.update(first.id, { status: "reassigned" })).toEqual({ ok: true });
        expect(await repo.create({ ...match, mentor_member_id: id(cy) })).toEqual({ ok: true });
        // Putting the reassigned one back would be a second live match.
        expect(await repo.update(first.id, { status: "matched" })).toEqual({ ok: false, reason: "already_matched" });
        expect((await repo.listWithMembers()).find((m) => m.id === first.id)?.status).toBe("reassigned");
      });

      it("refuses a match for a member that does not exist", async () => {
        await expect(ctx.repo().create({ mentor_member_id: ctx.missingMemberId, new_member_id: id(bo), started_on: "2026-02-01", kind: "direct" })).rejects.toThrow();
      });

      it("changes a note, leaves the rest, ignores an unknown match, and deletes", async () => {
        const repo = ctx.repo();
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(bo), started_on: "2026-02-01", kind: "trial" });
        const match = (await repo.listWithMembers()).find((m) => m.mentor_member_id === id(ada))!;

        expect(await repo.update(match.id, { outcome_note: "Busy month" })).toEqual({ ok: true });
        expect(await repo.update(ctx.missingId, { outcome_note: "x" })).toEqual({ ok: true });
        expect((await repo.listWithMembers()).find((m) => m.id === match.id)).toMatchObject({ outcome_note: "Busy month", status: "matched", kind: "trial" });

        await repo.delete(match.id);
        expect((await repo.listWithMembers()).find((m) => m.id === match.id)).toBeUndefined();
        await repo.delete(match.id); // already gone
      });

      it("lists the live matches' arrivals", async () => {
        const repo = ctx.repo();
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(bo), started_on: "2026-02-01", kind: "direct" });
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(cy), started_on: "2026-02-02", kind: "direct" });
        const cyMatch = (await repo.listWithMembers()).find((m) => m.new_member_id === id(cy))!;
        await repo.update(cyMatch.id, { status: "reassigned" });

        const ours = (await repo.matchedArrivals()).filter((a) => [id(bo), id(cy)].includes(a.new_member_id));
        expect(ours).toEqual([{ new_member_id: id(bo), started_on: "2026-02-01" }]);
      });
    });

    describe("volunteers", () => {
      it("puts a member on the pool, keeps their note, takes them off and back on", async () => {
        const repo = ctx.repo();
        expect(await repo.volunteerNote(id(ada))).toBeNull();

        await repo.volunteer(id(ada), "Happy to help");
        await repo.volunteer(id(bo), null);
        expect(await repo.volunteerNote(id(ada))).toEqual({ note: "Happy to help" });
        expect(await repo.volunteerNote(id(bo))).toEqual({ note: null });

        const listed = (await repo.volunteers()).filter((v) => [id(ada), id(bo)].includes(v.member_id));
        expect(listed.map((v) => v.member_id).sort()).toEqual([id(ada), id(bo)].sort());
        const adaRow = listed.find((v) => v.member_id === id(ada))!;
        expect(adaRow).toMatchObject({ note: "Happy to help", member: { name: ctx.members[ada].name, display_name: "Ada E." } });

        await repo.withdraw(id(ada));
        await repo.withdraw(id(ada)); // already withdrawn
        await repo.withdraw(id(cy)); // never volunteered
        expect(await repo.volunteerNote(id(ada))).toBeNull();
        expect((await repo.volunteers()).some((v) => v.member_id === id(ada))).toBe(false);

        await repo.volunteer(id(ada), "Back again");
        expect(await repo.volunteerNote(id(ada))).toEqual({ note: "Back again" });
        const again = (await repo.volunteers()).find((v) => v.member_id === id(ada))!;
        expect(again.created_at).toBe(adaRow.created_at);
      });

      it("refuses a volunteer that is not a member", async () => {
        await expect(ctx.repo().volunteer(ctx.missingMemberId, null)).rejects.toThrow();
      });
    });

    describe("functions", () => {
      it("counts a mentor's live matches that have started", async () => {
        const repo = ctx.repo();
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(bo), started_on: "2020-01-10", kind: "direct" });
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(cy), started_on: "2020-03-10", kind: "direct" });
        await repo.create({ mentor_member_id: id(ada), new_member_id: id(dee), started_on: "2020-05-10", kind: "direct" });
        await repo.create({ mentor_member_id: id(cy), new_member_id: id(dee), started_on: "2999-01-01", kind: "direct" });
        const reassigned = (await repo.listWithMembers()).find((m) => m.new_member_id === id(dee) && m.mentor_member_id === id(ada))!;
        await repo.update(reassigned.id, { status: "reassigned" });

        const counts = await repo.counts();
        expect(counts.find((c) => c.member_id === id(ada))).toMatchObject({ mentored_count: 2, first_started_on: "2020-01-10", last_started_on: "2020-03-10" });
        expect(counts.find((c) => c.member_id === id(cy))).toBeUndefined();
      });

      it("answers for no one with no matches, and refuses a note on a match that is not there", async () => {
        const repo = ctx.repo();
        expect(await repo.myMentorships(id(dee))).toEqual([]);
        expect(await repo.setNote(ctx.missingId, "x")).toBe(false);
        await expect(repo.setNote(ctx.missingId, "x".repeat(1001))).rejects.toThrow();
      });
    });
  });
}
