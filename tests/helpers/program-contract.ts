import { describe, it, expect, beforeEach } from "vitest";
import { ProgramEnrollmentExistsError, type ProgramRepository } from "@/lib/data/programs";

export type ProgramContractContext = {
  repo: () => ProgramRepository;
  /** A string no other run has used (programs are unique by name and slug). */
  unique: (label: string) => string;
  /**
   * Three members: "Ada Example" (display name "Ada E.", status "cancelled"), "Bo Example" and "Cy Example"
   * (staff role "staff"). Emails are `members[i].email`.
   */
  members: readonly { id: string; name: string; email: string }[];
  /** A year no other test's cohorts start in, so a date window holds only what the contract stored. */
  year: number;
  /** An id nothing has. */
  missingId: string;
  /** Removes the programs this context made (their cohorts and enrollments go with them). */
  clear: () => Promise<void>;
};

/** Behavior every `ProgramRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineProgramContract(name: string, setup: () => ProgramContractContext) {
  describe(`${name} (ProgramRepository contract)`, () => {
    let ctx: ProgramContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const day = (month: number, d = 1) => `${ctx.year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const program = async (label: string, extra: Record<string, unknown> = {}) => {
      const tag = ctx.unique(label);
      return ctx.repo().create({ name: `Program ${tag}`, slug: `program-${tag}`.toLowerCase().replace(/\s+/g, "-"), ...extra });
    };
    const cohort = (programId: string, label: string, starts: string, expires: string) =>
      ctx.repo().createCohort({ program_id: programId, name: `Cohort ${label}`, starts_at: starts, expires_at: expires });
    const enroll = (member: number, cohortId: string, created = "2000-01-01T00:00:00Z", notes?: string) =>
      ctx.repo().enroll({ member_id: ctx.members[member].id, cohort_id: cohortId, created_at: created, notes });

    it("creates a program with its defaults, finds it by id and slug, changes and deletes it", async () => {
      const p = await program("basic");
      expect(p).toMatchObject({ description: null, includes_membership: true, kajabi_offer_names: [] });
      expect(await ctx.repo().byId(p.id)).toEqual(p);
      expect(await ctx.repo().idBySlug(p.slug)).toBe(p.id);
      expect(await ctx.repo().byId(ctx.missingId)).toBeNull();
      expect(await ctx.repo().idBySlug(`${p.slug}-nope`)).toBeNull();

      const changed = await ctx.repo().update(p.id, { description: "Hello", kajabi_offer_names: ["Offer A"], includes_membership: false });
      expect(changed).toMatchObject({ id: p.id, name: p.name, description: "Hello", kajabi_offer_names: ["Offer A"], includes_membership: false });
      expect(await ctx.repo().byId(p.id)).toMatchObject({ description: "Hello" });
      await expect(ctx.repo().update(ctx.missingId, { description: "x" })).rejects.toThrow();

      await ctx.repo().delete(p.id);
      expect(await ctx.repo().byId(p.id)).toBeNull();
      await ctx.repo().delete(p.id); // already gone
    });

    it("refuses a second program with the same slug", async () => {
      const p = await program("dup");
      await expect(ctx.repo().create({ name: `Other ${p.name}`, slug: p.slug })).rejects.toThrow();
    });

    it("lists program names by name, and counts cohorts and enrollments", async () => {
      const b = await program("b");
      const a = await program("a");
      const c1 = await cohort(a.id, "1", day(1), day(2));
      await cohort(a.id, "2", day(3), day(4));
      await enroll(ada, c1.id);
      await enroll(bo, c1.id);

      const names = (await ctx.repo().names()).filter((n) => [a.id, b.id].includes(n.id));
      expect(names).toEqual([a, b].sort((x, y) => (x.name < y.name ? -1 : 1)).map(({ id, name }) => ({ id, name })));

      const counts = (await ctx.repo().listWithCounts()).filter((n) => [a.id, b.id].includes(n.id));
      expect(counts.map((p) => [p.id, p.cohort_count, p.enrollment_count])).toEqual([a, b].sort((x, y) => (x.name < y.name ? -1 : 1)).map((p) => [p.id, p === a ? 2 : 0, p === a ? 2 : 0]));
      expect(counts[0]).not.toHaveProperty("program_cohorts");
    });

    it("lists a program's cohorts latest first with their enrollments and members", async () => {
      const p = await program("cohorts");
      const early = await cohort(p.id, "early", day(1), day(2));
      const late = await cohort(p.id, "late", day(5), day(6));
      await cohort((await program("other")).id, "elsewhere", day(7), day(8));
      await enroll(bo, late.id, "2000-01-02T00:00:00Z", "second");
      await enroll(ada, late.id, "2000-01-01T00:00:00Z", "first");

      const listed = await ctx.repo().cohortsWithEnrollments(p.id);
      expect(listed.map((c) => c.id)).toEqual([late.id, early.id]);
      expect(listed[0]).toMatchObject({ name: "Cohort late", program_id: p.id, starts_at: day(5), expires_at: day(6) });
      expect(listed[1].member_program_enrollments).toEqual([]);
      expect(listed[0].member_program_enrollments).toEqual([
        { id: expect.any(String), notes: "first", created_at: expect.any(String), member: { id: ctx.members[ada].id, name: ctx.members[ada].name, display_name: "Ada E.", email: ctx.members[ada].email, status: "cancelled" } },
        { id: expect.any(String), notes: "second", created_at: expect.any(String), member: expect.objectContaining({ id: ctx.members[bo].id, display_name: null, status: "active" }) },
      ]);
      expect(await ctx.repo().cohortsWithEnrollments(ctx.missingId)).toEqual([]);
    });

    it("creates, changes and deletes a cohort, taking its enrollments with it", async () => {
      const p = await program("cohort-crud");
      const c = await cohort(p.id, "x", day(1), day(2));
      expect(c).toMatchObject({ program_id: p.id, notes: null, created_by: null });
      await enroll(ada, c.id);

      expect(await ctx.repo().updateCohort(c.id, { name: "Renamed", notes: "n" })).toMatchObject({ id: c.id, name: "Renamed", notes: "n", starts_at: day(1) });
      await expect(ctx.repo().updateCohort(ctx.missingId, { name: "x" })).rejects.toThrow();
      await expect(ctx.repo().createCohort({ program_id: ctx.missingId, name: "x", starts_at: day(1), expires_at: day(2) })).rejects.toThrow();
      await expect(ctx.repo().createCohort({ program_id: p.id, name: "x", starts_at: day(2), expires_at: day(1) })).rejects.toThrow();

      await ctx.repo().deleteCohort(c.id);
      expect(await ctx.repo().cohortsWithEnrollments(p.id)).toEqual([]);
      expect(await ctx.repo().enrollmentsOf(ctx.members[ada].id)).toEqual([]);
    });

    it("deleting a program takes its cohorts and enrollments with it", async () => {
      const p = await program("cascade");
      const c = await cohort(p.id, "x", day(1), day(2));
      await enroll(ada, c.id);
      await ctx.repo().delete(p.id);
      expect(await ctx.repo().cohortForMatching(c.id)).toBeNull();
      expect(await ctx.repo().memberIdsInCohort(c.id)).toEqual(new Set());
    });

    it("reads a cohort with the offer names of its program, and nothing for an unknown cohort", async () => {
      const p = await program("matching", { kajabi_offer_names: ["Offer A", "Offer B"] });
      const c = await cohort(p.id, "x", day(1), day(2));
      expect(await ctx.repo().cohortForMatching(c.id)).toEqual({ id: c.id, starts_at: day(1), expires_at: day(2), program: { id: p.id, kajabi_offer_names: ["Offer A", "Offer B"] } });
      expect(await ctx.repo().cohortForMatching(ctx.missingId)).toBeNull();
    });

    it("enrolls a member once per cohort and removes an enrollment", async () => {
      const p = await program("enroll");
      const c = await cohort(p.id, "x", day(1), day(2));
      const enrolled = await ctx.repo().enroll({ member_id: ctx.members[ada].id, cohort_id: c.id, notes: "hi" });
      expect(enrolled).toMatchObject({ member_id: ctx.members[ada].id, cohort_id: c.id, notes: "hi", created_by: null, member: { id: ctx.members[ada].id, name: ctx.members[ada].name, email: ctx.members[ada].email } });

      await expect(enroll(ada, c.id)).rejects.toBeInstanceOf(ProgramEnrollmentExistsError);
      await expect(ctx.repo().enroll({ member_id: ctx.members[bo].id, cohort_id: ctx.missingId })).rejects.toThrow();
      await expect(ctx.repo().enroll({ member_id: ctx.missingId, cohort_id: c.id })).rejects.toThrow();

      await enroll(bo, c.id);
      expect(await ctx.repo().memberIdsInCohort(c.id)).toEqual(new Set([ctx.members[ada].id, ctx.members[bo].id]));
      await ctx.repo().unenroll(enrolled.id);
      expect(await ctx.repo().memberIdsInCohort(c.id)).toEqual(new Set([ctx.members[bo].id]));
      expect(await ctx.repo().memberIdsInCohort(ctx.missingId)).toEqual(new Set());
    });

    it("lists a member's enrollments newest first with their cohort and program", async () => {
      const p = await program("member-view", { includes_membership: false });
      const q = await program("member-view-2");
      const c1 = await cohort(p.id, "1", day(1), day(2));
      const c2 = await cohort(q.id, "2", day(3), day(4));
      await enroll(ada, c1.id, "2000-01-01T00:00:00Z");
      await enroll(ada, c2.id, "2000-01-02T00:00:00Z");
      await enroll(bo, c1.id);

      const mine = await ctx.repo().enrollmentsOf(ctx.members[ada].id);
      expect(mine.map((e) => e.cohortId)).toEqual([c2.id, c1.id]);
      expect(mine[0]).toEqual({ id: expect.any(String), createdAt: expect.any(String), cohortId: c2.id, programId: q.id, programName: q.name, includesMembership: true, startsAt: day(3), expiresAt: day(4) });
      expect(mine[1]).toMatchObject({ programId: p.id, programName: p.name, includesMembership: false });
      expect(await ctx.repo().enrollmentsOf(ctx.missingId)).toEqual([]);
    });

    it("lists every member's cohort ends with the program", async () => {
      const p = await program("ends");
      const c = await cohort(p.id, "1", day(1), day(2));
      await enroll(ada, c.id);
      await enroll(bo, c.id);
      const ours = (await ctx.repo().allEnrollmentCohorts()).filter((e) => e.programId === p.id);
      expect(ours.map((e) => e.memberId).sort()).toEqual([ctx.members[ada].id, ctx.members[bo].id].sort());
      expect(ours[0]).toEqual({ memberId: expect.any(String), programId: p.id, expiresAt: day(2) });
    });

    it("finds enrollments in cohorts that started in a window, of programs that include membership", async () => {
      const yes = await program("arrivals");
      const no = await program("arrivals-no", { includes_membership: false });
      const inside = await cohort(yes.id, "in", day(4, 10), day(6));
      const edge = await cohort(yes.id, "edge", day(4, 20), day(6));
      const before = await cohort(yes.id, "before", day(4, 9), day(6));
      const after = await cohort(yes.id, "after", day(4, 21), day(6));
      const course = await cohort(no.id, "course", day(4, 15), day(6));
      await enroll(ada, inside.id);
      await enroll(cy, edge.id);
      for (const c of [before, after, course]) await enroll(bo, c.id);

      const found = await ctx.repo().membershipArrivals(day(4, 10), day(4, 20));
      const ours = found.filter((a) => [ctx.members[ada].id, ctx.members[bo].id, ctx.members[cy].id].includes(a.member?.id ?? ""));
      expect(ours.map((a) => [a.member?.id, a.startsOn, a.programName]).sort()).toEqual(
        [
          [ctx.members[ada].id, day(4, 10), yes.name],
          [ctx.members[cy].id, day(4, 20), yes.name],
        ].sort(),
      );
      const adaArrival = ours.find((a) => a.member?.id === ctx.members[ada].id)!;
      expect(adaArrival.member).toEqual({ id: ctx.members[ada].id, name: ctx.members[ada].name, display_name: "Ada E.", email: ctx.members[ada].email, staff_role: null });
      expect(ours.find((a) => a.member?.id === ctx.members[cy].id)!.member?.staff_role).toBe("staff");
    });

    it("moves a member's enrollments to another member, dropping the ones they share", async () => {
      const p = await program("merge");
      const [c1, c2, c3] = await Promise.all([cohort(p.id, "1", day(1), day(2)), cohort(p.id, "2", day(3), day(4)), cohort(p.id, "3", day(5), day(6))]);
      await enroll(ada, c1.id, "2000-01-01T00:00:00Z", "from ada");
      await enroll(ada, c2.id, "2000-01-02T00:00:00Z");
      await enroll(bo, c1.id, "2000-01-03T00:00:00Z");
      await enroll(bo, c3.id, "2000-01-04T00:00:00Z");

      await ctx.repo().moveEnrollments(ctx.members[ada].id, ctx.members[bo].id);

      expect(await ctx.repo().enrollmentsOf(ctx.members[ada].id)).toEqual([]);
      expect((await ctx.repo().enrollmentsOf(ctx.members[bo].id)).map((e) => e.cohortId).sort()).toEqual([c1.id, c2.id, c3.id].sort());
      const cohorts = await ctx.repo().cohortsWithEnrollments(p.id);
      expect(cohorts.find((c) => c.id === c1.id)!.member_program_enrollments).toHaveLength(1);
      // Nothing to move is fine.
      await ctx.repo().moveEnrollments(ctx.members[ada].id, ctx.members[bo].id);
    });

    it("tells which members are already in another cohort of the program, by the one they joined first", async () => {
      const p = await program("elsewhere");
      const other = await program("elsewhere-other");
      const current = await cohort(p.id, "current", day(1), day(2));
      const second = await cohort(p.id, "second", day(3), day(4));
      const third = await cohort(p.id, "third", day(5), day(6));
      const unrelated = await cohort(other.id, "unrelated", day(1), day(2));
      await enroll(ada, third.id, "2000-01-02T00:00:00Z");
      await enroll(ada, second.id, "2000-01-01T00:00:00Z");
      await enroll(bo, current.id);
      await enroll(cy, unrelated.id);

      const ids = ctx.members.map((m) => m.id);
      expect(await ctx.repo().enrolledElsewhere(p.id, current.id, ids)).toEqual(new Map([[ctx.members[ada].id, "Cohort second"]]));
      expect(await ctx.repo().enrolledElsewhere(p.id, current.id, [])).toEqual(new Map());
      expect(await ctx.repo().enrolledElsewhere(other.id, unrelated.id, ids)).toEqual(new Map());
      expect(await ctx.repo().enrolledElsewhere(p.id, current.id, [ids[ada], ids[ada]])).toEqual(new Map([[ids[ada], "Cohort second"]]));
    });
  });
}
