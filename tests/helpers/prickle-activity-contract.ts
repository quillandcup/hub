import { describe, it, expect, beforeEach } from "vitest";
import { CommitmentConflictError, type CheckinHalfKind, type PrickleActivityRepository } from "@/lib/data/prickle-activity";
import { EMPTY_CHECKIN, type CheckinInput } from "@/lib/prickle-checkins";

export type ActivityContractPrickle = { id: string; typeId: string; hostId: string | null };

export type PrickleActivityContractContext = {
  repo: () => PrickleActivityRepository;
  /** Two members that exist. */
  members: [string, string];
  /** Two prickle types that exist. */
  types: [{ id: string; name: string }, { id: string; name: string }];
  /** Three prickles that exist: the first of the first type hosted by the second member, the second of the second type, the third of the first type (the last two have no host). */
  prickles: [ActivityContractPrickle, ActivityContractPrickle, ActivityContractPrickle];
  /** Removes whatever earlier tests left for these members, so each test starts empty. */
  reset: () => Promise<void>;
};

const ET = "America/New_York";
const answers = (extra: Partial<CheckinInput>): CheckinInput => ({ ...EMPTY_CHECKIN, ...extra });
const BEFORE = answers({ pleasantBefore: 3, energyBefore: 4, emotionBefore: null, need: "company" });

/** Behavior every `PrickleActivityRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function definePrickleActivityContract(name: string, setup: () => PrickleActivityContractContext) {
  describe(`${name} (PrickleActivityRepository contract)`, () => {
    let ctx: PrickleActivityContractContext;
    let m1: string;
    let m2: string;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
      [m1, m2] = ctx.members;
    });

    describe("commitments", () => {
      const slot = (typeId: string, dayOfWeek: number, startTimeLocal: string) => ({ typeId, dayOfWeek, startTimeLocal, timezone: ET });

      it("creates a commitment with its slots in day-then-time order, with the type names", async () => {
        const [t0, t1] = ctx.types;
        const id = await ctx.repo().createCommitment({
          memberId: m1,
          startDate: "2097-01-05",
          weeks: 2,
          slots: [slot(t1.id, 3, "07:00"), slot(t0.id, 1, "09:30"), slot(t0.id, 1, "07:00")],
        });
        expect(await ctx.repo().commitmentsOf(m1)).toEqual([
          {
            id,
            startDate: "2097-01-05",
            weeks: 2,
            status: "active",
            cancelledAt: null,
            slots: [
              { typeId: t0.id, dayOfWeek: 1, startTimeLocal: "07:00:00", timezone: ET, typeName: t0.name },
              { typeId: t0.id, dayOfWeek: 1, startTimeLocal: "09:30:00", timezone: ET, typeName: t0.name },
              { typeId: t1.id, dayOfWeek: 3, startTimeLocal: "07:00:00", timezone: ET, typeName: t1.name },
            ],
          },
        ]);
        expect(await ctx.repo().commitmentsOf(m2)).toEqual([]);
        expect(await ctx.repo().commitmentOwner(id)).toEqual({ id, memberId: m1, status: "active" });
      });

      it("knows no owner for a commitment that does not exist", async () => {
        expect(await ctx.repo().commitmentOwner("pcmt_AAAAAAAAAAA9")).toBeNull();
      });

      it("lists the newest window first and filters by status and by when the window ends", async () => {
        const [t0, t1] = ctx.types;
        const repo = ctx.repo();
        const old = await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
        const newer = await repo.createCommitment({ memberId: m1, startDate: "2097-03-02", weeks: 4, slots: [slot(t1.id, 2, "08:00")] });
        expect((await repo.commitmentsOf(m1)).map((c) => c.id)).toEqual([newer, old]);
        // The older window ends 2097-01-18, the newer 2097-03-29.
        expect((await repo.commitmentsOf(m1, { endsOnOrAfter: "2097-01-18" })).map((c) => c.id)).toEqual([newer, old]);
        expect((await repo.commitmentsOf(m1, { endsOnOrAfter: "2097-01-19" })).map((c) => c.id)).toEqual([newer]);
        expect(await repo.cancelCommitment(newer, m1, "2097-01-01T00:00:00.000Z")).toBe(true);
        expect((await repo.commitmentsOf(m1, { status: "active" })).map((c) => c.id)).toEqual([old]);
        expect((await repo.commitmentsOf(m1, { status: "cancelled" })).map((c) => [c.id, c.cancelledAt?.slice(0, 10)])).toEqual([[newer, "2097-01-01"]]);
      });

      it("refuses a slot already committed for overlapping weeks, but not for later ones or another time", async () => {
        const [t0] = ctx.types;
        const repo = ctx.repo();
        await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
        await expect(repo.createCommitment({ memberId: m1, startDate: "2097-01-12", weeks: 2, slots: [slot(t0.id, 1, "07:00")] })).rejects.toBeInstanceOf(CommitmentConflictError);
        await repo.createCommitment({ memberId: m1, startDate: "2097-01-19", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
        await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "08:00")] });
        await repo.createCommitment({ memberId: m2, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
      });

      it("marks only active commitments completed, and cancels only the member's own", async () => {
        const [t0, t1] = ctx.types;
        const repo = ctx.repo();
        const a = await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
        const b = await repo.createCommitment({ memberId: m1, startDate: "2097-02-02", weeks: 2, slots: [slot(t1.id, 2, "07:00")] });
        expect(await repo.cancelCommitment(b, m2, "2097-01-01T00:00:00.000Z")).toBe(false);
        expect(await repo.cancelCommitment(b, m1, "2097-01-01T00:00:00.000Z")).toBe(true);
        await repo.markCommitmentsCompleted([a, b], "2097-01-02T00:00:00.000Z");
        await repo.markCommitmentsCompleted([], "2097-01-02T00:00:00.000Z");
        const status = Object.fromEntries((await repo.commitmentsOf(m1)).map((c) => [c.id, c.status]));
        expect(status).toEqual({ [a]: "completed", [b]: "cancelled" });
      });

      it("counts a member's active commitments", async () => {
        const [t0, t1] = ctx.types;
        const repo = ctx.repo();
        expect(await repo.countActiveCommitments(m1)).toBe(0);
        await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00")] });
        const other = await repo.createCommitment({ memberId: m1, startDate: "2097-02-02", weeks: 2, slots: [slot(t1.id, 2, "07:00")] });
        await repo.createCommitment({ memberId: m2, startDate: "2097-02-02", weeks: 2, slots: [slot(t1.id, 2, "07:00")] });
        expect(await repo.countActiveCommitments(m1)).toBe(2);
        await repo.cancelCommitment(other, m1, "2097-01-01T00:00:00.000Z");
        expect(await repo.countActiveCommitments(m1)).toBe(1);
      });

      it("lists everyone's claim on a weekly slot", async () => {
        const [t0, t1] = ctx.types;
        const repo = ctx.repo();
        await repo.createCommitment({ memberId: m1, startDate: "2097-01-05", weeks: 2, slots: [slot(t0.id, 1, "07:00"), slot(t1.id, 3, "07:00")] });
        const cancelled = await repo.createCommitment({ memberId: m2, startDate: "2097-01-05", weeks: 4, slots: [slot(t0.id, 1, "09:00")] });
        await repo.cancelCommitment(cancelled, m2, "2097-01-01T00:00:00.000Z");
        const claims = await repo.slotCommitments({ typeId: t0.id, dayOfWeek: 1, timezone: ET });
        expect(claims.sort((a, b) => a.startTimeLocal.localeCompare(b.startTimeLocal))).toEqual([
          { memberId: m1, status: "active", startDate: "2097-01-05", endDate: "2097-01-18", startTimeLocal: "07:00:00" },
          { memberId: m2, status: "cancelled", startDate: "2097-01-05", endDate: "2097-02-01", startTimeLocal: "09:00:00" },
        ]);
        expect(await repo.slotCommitments({ typeId: t0.id, dayOfWeek: 2, timezone: ET })).toEqual([]);
        expect(await repo.slotCommitments({ typeId: t0.id, dayOfWeek: 1, timezone: "America/Chicago" })).toEqual([]);
      });
    });

    describe("check-ins", () => {
      it("saves a check-in, replaces it on the next save and reads it back by member and prickle", async () => {
        const [p0, p1] = ctx.prickles;
        const repo = ctx.repo();
        expect(await repo.checkinOf(m1, p0.id)).toBeNull();
        await repo.saveCheckin(m1, p0.id, BEFORE, "web");
        expect(await repo.checkinOf(m1, p0.id)).toEqual(BEFORE);
        const full = answers({ ...BEFORE, intentionMet: 4, pleasantAfter: 5, energyAfter: 3, emotionAfter: null });
        await repo.saveCheckin(m1, p0.id, full, "slack");
        expect(await repo.checkinOf(m1, p0.id)).toEqual(full);
        expect(await repo.checkinOf(m2, p0.id)).toBeNull();
        expect(await repo.checkinOf(m1, p1.id)).toBeNull();
      });

      it("reads many check-ins at once, for one member or several", async () => {
        const [p0, p1, p2] = ctx.prickles;
        const repo = ctx.repo();
        const other = answers({ pleasantBefore: 1, energyBefore: 2, need: "unstuck" });
        await repo.saveCheckin(m1, p0.id, BEFORE, "web");
        await repo.saveCheckin(m1, p1.id, other, "web");
        await repo.saveCheckin(m2, p0.id, other, "slack");
        expect(await repo.checkinsOf(m1)).toEqual(new Map([[p0.id, BEFORE], [p1.id, other]]));
        expect(await repo.checkinsAmong(m1, [p1.id, p2.id])).toEqual(new Map([[p1.id, other]]));
        expect(await repo.checkinsAmong(m1, [])).toEqual(new Map());
        expect(await repo.checkinsOfMembers([m1, m2], [p0.id, p2.id])).toEqual(
          new Map([[`${m1}:${p0.id}`, BEFORE], [`${m2}:${p0.id}`, other]])
        );
        expect(await repo.checkinsOfMembers([], [p0.id])).toEqual(new Map());
      });

      it("soft deletes a check-in cleared of every answer, and restores it on the next save", async () => {
        const [p0] = ctx.prickles;
        const repo = ctx.repo();
        await repo.saveCheckin(m1, p0.id, EMPTY_CHECKIN, "web"); // nothing to clear: no row appears
        expect(await repo.checkinOf(m1, p0.id)).toBeNull();
        await repo.saveCheckin(m1, p0.id, BEFORE, "web");
        await repo.saveCheckin(m1, p0.id, EMPTY_CHECKIN, "web");
        expect(await repo.checkinOf(m1, p0.id)).toBeNull();
        expect((await repo.checkinsOf(m1)).size).toBe(0);
        await repo.saveCheckin(m1, p0.id, EMPTY_CHECKIN, "web"); // already cleared: still fine
        await repo.saveCheckin(m1, p0.id, BEFORE, "slack");
        expect(await repo.checkinOf(m1, p0.id)).toEqual(BEFORE);
      });

      it("lists the check-ins the member rated, with the type and host of their prickle", async () => {
        const [p0, p1, p2] = ctx.prickles;
        const repo = ctx.repo();
        await repo.saveCheckin(m1, p0.id, answers({ pleasantBefore: 2, energyBefore: 3, need: "company", intentionMet: 4 }), "web");
        await repo.saveCheckin(m1, p1.id, answers({ intentionMet: 1 }), "web");
        await repo.saveCheckin(m1, p2.id, BEFORE, "web"); // not rated
        await repo.saveCheckin(m2, p0.id, answers({ intentionMet: 5 }), "web"); // someone else's
        const rated = await repo.ratedCheckinsOf(m1);
        expect(rated.sort((a, b) => ((a.typeId ?? "") < (b.typeId ?? "") ? -1 : (a.typeId ?? "") > (b.typeId ?? "") ? 1 : a.intentionMet - b.intentionMet))).toEqual(
          [
            { typeId: p0.typeId, hostId: p0.hostId, pleasantBefore: 2, energyBefore: 3, emotionBefore: null, need: "company", intentionMet: 4 },
            { typeId: p1.typeId, hostId: p1.hostId, pleasantBefore: null, energyBefore: null, emotionBefore: null, need: null, intentionMet: 1 },
          ].sort((a, b) => ((a.typeId ?? "") < (b.typeId ?? "") ? -1 : (a.typeId ?? "") > (b.typeId ?? "") ? 1 : a.intentionMet - b.intentionMet))
        );
        await repo.saveCheckin(m1, p0.id, EMPTY_CHECKIN, "web"); // cleared: no longer counts
        expect(await repo.ratedCheckinsOf(m1)).toHaveLength(1);
      });
    });

    describe.each<CheckinHalfKind>(["checkin", "checkout"])("dismissed %s offers", (half) => {
      const other: CheckinHalfKind = half === "checkin" ? "checkout" : "checkin";

      it("records a dismissal once, however often it is dismissed, apart from the other half", async () => {
        const [p0, p1] = ctx.prickles;
        const repo = ctx.repo();
        await repo.dismiss(half, m1, p0.id);
        await repo.dismiss(half, m1, p0.id);
        await repo.dismiss(half, m2, p1.id);
        expect(await repo.dismissedAmong(half, m1, [p0.id, p1.id])).toEqual(new Set([p0.id]));
        expect(await repo.dismissedAmong(half, m1, [])).toEqual(new Set());
        expect(await repo.dismissedAmong(other, m1, [p0.id, p1.id])).toEqual(new Set());
        expect(await repo.dismissedPairs(half, [p0.id, p1.id])).toEqual(new Set([`${m1}:${p0.id}`, `${m2}:${p1.id}`]));
        expect(await repo.dismissedPairs(half, [p0.id])).toEqual(new Set([`${m1}:${p0.id}`]));
        expect(await repo.dismissedPairs(half, [])).toEqual(new Set());
        expect(await repo.dismissedPairs(other, [p0.id, p1.id])).toEqual(new Set());
      });

      it("lists the member's dismissals since an instant", async () => {
        const [p0] = ctx.prickles;
        const repo = ctx.repo();
        await repo.dismiss(half, m1, p0.id);
        const hour = 3_600_000;
        expect(await repo.dismissedSince(half, m1, new Date(Date.now() - hour).toISOString())).toEqual(new Set([p0.id]));
        expect(await repo.dismissedSince(half, m1, new Date(Date.now() + hour).toISOString())).toEqual(new Set());
        expect(await repo.dismissedSince(half, m2, new Date(Date.now() - hour).toISOString())).toEqual(new Set());
      });
    });
  });
}
