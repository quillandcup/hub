import { describe, it, expect, beforeEach } from "vitest";
import type { AttendanceRepository } from "@/lib/data/attendance";
import type { PrickleDetail } from "@/lib/data/prickles";

/** A seeded record, naming members and prickles by position in the context's id lists. */
export type ContractMember = { id: string; name: string; displayName: string | null; email: string };

export type SeedRecord = { member: 0 | 1 | 2; prickle: 0 | 1 | 2; join: string; leave?: string };

export type AttendanceContractContext = {
  memberIds: readonly [string, string, string];
  prickleIds: readonly [string, string, string];
  /** What the joins should report for each member: member 0 has a pen name, 1 has none, 2 hosts prickle 0. */
  members: readonly [ContractMember, ContractMember, ContractMember];
  /**
   * What the joins should report for each prickle: 0 is a "writing" prickle hosted by member 2,
   * 1 a "social" prickle with no host, 2 a "writing" one with no host; they start an hour apart, in that order.
   */
  prickles: readonly [PrickleDetail, PrickleDetail, PrickleDetail];
  /** The repository under test, over exactly the records passed to the last `seed`. */
  repo: () => AttendanceRepository;
  /** Replace all records for the context's members and prickles with these. */
  seed: (records: SeedRecord[]) => Promise<void>;
};

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-01T15:00:00Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

/**
 * Behavior every `AttendanceRepository` must have. Run against the in-memory twin (unit) and the
 * Supabase one (db) so they can't drift apart: callers are tested against the first, the second is
 * proven to match it.
 */
export function defineAttendanceContract(name: string, setup: () => AttendanceContractContext) {
  describe(`${name} (AttendanceRepository contract)`, () => {
    let ctx: AttendanceContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("counts a prickle once however often the member left and rejoined", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0), leave: at(0.5) },
        { member: 0, prickle: 0, join: at(1), leave: at(2) },
        { member: 0, prickle: 1, join: at(30) },
      ]);

      expect(await ctx.repo().attendedPrickleIds(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0], ctx.prickleIds[1]]));
      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(3); // records, not prickles
      expect(await ctx.repo().countForMember(ctx.memberIds[1])).toBe(0);
    });

    it("lists distinct prickles per member", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 0, join: at(1) },
        { member: 1, prickle: 0, join: at(0) },
        { member: 1, prickle: 2, join: at(50) },
      ]);

      const byMember = await ctx.repo().attendedPrickleIdsByMember();

      expect(byMember.get(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0]]));
      expect(byMember.get(ctx.memberIds[1])).toEqual(new Set([ctx.prickleIds[0], ctx.prickleIds[2]]));
      expect(byMember.has(ctx.memberIds[2])).toBe(false);
    });

    it("returns one entry per record for the prickles asked about, and nothing for none", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 0, join: at(1) },
        { member: 1, prickle: 1, join: at(30) },
        { member: 2, prickle: 2, join: at(50) },
      ]);

      const links = await ctx.repo().forPrickles([ctx.prickleIds[0], ctx.prickleIds[1]]);

      expect(links).toHaveLength(3);
      expect(links.filter((l) => l.memberId === ctx.memberIds[0] && l.prickleId === ctx.prickleIds[0])).toHaveLength(2);
      expect(links).toContainEqual({ memberId: ctx.memberIds[1], prickleId: ctx.prickleIds[1], joinTime: expect.any(String) });
      expect(links.map((l) => new Date(l.joinTime).getTime()).sort()).toEqual([at(0), at(1), at(30)].map((t) => Date.parse(t)));
      expect(await ctx.repo().forPrickles([])).toEqual([]);
    });

    it("lists every record, including ones for prickles nobody asked about", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 1, prickle: 2, join: at(50) },
      ]);

      const mine = (await ctx.repo().list()).filter((l) => ctx.memberIds.includes(l.memberId));

      expect(mine.map((l) => [l.memberId, l.prickleId])).toEqual(
        expect.arrayContaining([
          [ctx.memberIds[0], ctx.prickleIds[0]],
          [ctx.memberIds[1], ctx.prickleIds[2]],
        ]),
      );
      expect(mine).toHaveLength(2);
    });

    it("tells which of the prickles one member attended, and when they first joined each", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(1) },
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 2, join: at(50) },
        { member: 1, prickle: 1, join: at(30) },
      ]);
      const ids = [ctx.prickleIds[0], ctx.prickleIds[1]];

      expect(await ctx.repo().attendedAmong(ctx.memberIds[0], ids)).toEqual(new Set([ctx.prickleIds[0]]));
      const earliest = await ctx.repo().earliestJoinByPrickle(ctx.memberIds[0], ids);
      expect([...earliest.keys()]).toEqual([ctx.prickleIds[0]]);
      expect(new Date(earliest.get(ctx.prickleIds[0])!)).toEqual(new Date(at(0)));
      expect(await ctx.repo().attendedAmong(ctx.memberIds[0], [])).toEqual(new Set());
    });

    it("returns records that began in a window, inclusive at both ends", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0), leave: at(1) },
        { member: 1, prickle: 0, join: at(5), leave: at(7) },
        { member: 2, prickle: 0, join: at(10), leave: at(11) },
        { member: 2, prickle: 1, join: at(30) },
      ]);

      const spans = (await ctx.repo().joinedBetween(at(0), at(10))).filter((s) => ctx.memberIds.includes(s.memberId));

      expect(spans.map((s) => s.memberId).sort()).toEqual([...ctx.memberIds].sort());
      const second = spans.find((s) => s.memberId === ctx.memberIds[1])!;
      expect(new Date(second.leaveTime)).toEqual(new Date(at(7)));
    });

    it("says which of the prickles anyone attended", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 1, prickle: 0, join: at(1) },
        { member: 2, prickle: 2, join: at(2) },
      ]);

      const found = await ctx.repo().prickleIdsWithAttendance([ctx.prickleIds[0], ctx.prickleIds[1], ctx.prickleIds[2]]);

      expect(found).toEqual(new Set([ctx.prickleIds[0], ctx.prickleIds[2]]));
      expect(await ctx.repo().prickleIdsWithAttendance([])).toEqual(new Set());
    });

    it("says which members attended anything", async () => {
      await ctx.seed([
        { member: 1, prickle: 0, join: at(0) },
        { member: 1, prickle: 1, join: at(30) },
      ]);

      expect(await ctx.repo().membersWhoAttended(ctx.memberIds.slice())).toEqual(new Set([ctx.memberIds[1]]));
      expect(await ctx.repo().membersWhoAttended([])).toEqual(new Set());
    });

    it("keeps each member's latest join, and omits members who never attended", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(80) },
        { member: 0, prickle: 2, join: at(30) },
        { member: 1, prickle: 0, join: at(5) },
      ]);

      const last = await ctx.repo().lastJoinByMember(ctx.memberIds.slice());

      expect(last.get(ctx.memberIds[0])).toEqual(new Date(at(80)));
      expect(last.get(ctx.memberIds[1])).toEqual(new Date(at(5)));
      expect(last.has(ctx.memberIds[2])).toBe(false);
    });

    it("finds the earliest join, or null", async () => {
      await ctx.seed([
        { member: 0, prickle: 1, join: at(30) },
        { member: 0, prickle: 0, join: at(2) },
      ]);

      expect(new Date((await ctx.repo().firstJoinTime(ctx.memberIds[0]))!)).toEqual(new Date(at(2)));
      expect(await ctx.repo().firstJoinTime(ctx.memberIds[2])).toBeNull();
    });

    it("moves every record to the other member", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(30) },
        { member: 1, prickle: 0, join: at(0) },
      ]);

      await ctx.repo().reassign(ctx.memberIds[0], ctx.memberIds[2]);

      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(0);
      expect(await ctx.repo().countForMember(ctx.memberIds[2])).toBe(2);
      expect(await ctx.repo().countForMember(ctx.memberIds[1])).toBe(1);
    });

    it("gives the member's records newest first, each with its prickle, type and host joined in", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(30) },
        { member: 1, prickle: 2, join: at(50) },
      ]);

      const mine = await ctx.repo().forMemberWithPrickles(ctx.memberIds[0]);

      expect(mine.map((a) => a.prickleId)).toEqual([ctx.prickleIds[1], ctx.prickleIds[0]]);
      expect(mine[1].prickle).toEqual(ctx.prickles[0]);
      expect(mine[1].prickle?.host).toMatchObject({ id: ctx.memberIds[2] });
      expect(mine[0].prickle).toEqual(ctx.prickles[1]);
      expect(mine[0].prickle?.host).toBeNull();
      expect(new Date(mine[0].joinTime)).toEqual(new Date(at(30)));
    });

    it("limits a member's records to prickles of a purpose, or that started since a time", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(1) },
        { member: 0, prickle: 2, join: at(2) },
      ]);

      const writing = await ctx.repo().forMemberWithPrickles(ctx.memberIds[0], { purpose: "writing" });
      const recent = await ctx.repo().forMemberWithPrickles(ctx.memberIds[0], { prickleStartedSince: ctx.prickles[1].startTime });
      const both = await ctx.repo().forMemberWithPrickles(ctx.memberIds[0], {
        purpose: "writing",
        prickleStartedSince: ctx.prickles[1].startTime,
      });

      expect(writing.map((a) => a.prickleId).sort()).toEqual([ctx.prickleIds[0], ctx.prickleIds[2]].sort());
      expect(recent.map((a) => a.prickleId).sort()).toEqual([ctx.prickleIds[1], ctx.prickleIds[2]].sort());
      expect(both.map((a) => a.prickleId)).toEqual([ctx.prickleIds[2]]);
      expect(both[0].prickle).toEqual(ctx.prickles[2]);
    });

    it("lists a prickle's attendees earliest first with their names, and emails only when asked for", async () => {
      await ctx.seed([
        { member: 1, prickle: 0, join: at(2) },
        { member: 0, prickle: 0, join: at(1) },
        { member: 2, prickle: 1, join: at(0) },
      ]);

      const publicView = await ctx.repo().attendeesOf(ctx.prickleIds[0]);
      const adminView = await ctx.repo().attendeesOf(ctx.prickleIds[0], { includeEmail: true });

      expect(publicView.map((a) => a.memberId)).toEqual([ctx.memberIds[0], ctx.memberIds[1]]);
      expect(publicView[0]).toMatchObject({ name: ctx.members[0].name, displayName: ctx.members[0].displayName, email: null });
      expect(publicView[1]).toMatchObject({ name: ctx.members[1].name, displayName: null, email: null });
      expect(adminView.map((a) => [a.memberId, a.email])).toEqual([
        [ctx.memberIds[0], ctx.members[0].email],
        [ctx.memberIds[1], ctx.members[1].email],
      ]);
      expect(new Date(adminView[0].joinTime)).toEqual(new Date(at(1)));
    });

    it("lists the other members at a set of prickles, never the member's own records", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 1, prickle: 0, join: at(1) },
        { member: 2, prickle: 1, join: at(2) },
        { member: 1, prickle: 2, join: at(3) },
      ]);

      const others = await ctx.repo().coAttendees(ctx.memberIds[0], [ctx.prickleIds[0], ctx.prickleIds[1]]);

      expect(others.map((a) => [a.memberId, a.prickleId]).sort()).toEqual(
        [
          [ctx.memberIds[1], ctx.prickleIds[0]],
          [ctx.memberIds[2], ctx.prickleIds[1]],
        ].sort(),
      );
      expect(others.find((a) => a.memberId === ctx.memberIds[1])).toMatchObject({ name: ctx.members[1].name, email: null });
      expect(await ctx.repo().coAttendees(ctx.memberIds[0], [])).toEqual([]);
    });

    it("names the attendee on records that began in a window", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 1, prickle: 0, join: at(5) },
        { member: 2, prickle: 0, join: at(40) },
      ]);

      const found = (await ctx.repo().attendeesJoinedBetween(at(0), at(10))).filter((a) => ctx.memberIds.includes(a.memberId));

      expect(found.map((a) => a.memberId).sort()).toEqual([ctx.memberIds[0], ctx.memberIds[1]].sort());
      expect(found.find((a) => a.memberId === ctx.memberIds[0])).toMatchObject({ name: ctx.members[0].name, displayName: ctx.members[0].displayName });
    });

    it("finds a member's latest join, up to a time if given", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(30) },
        { member: 0, prickle: 2, join: at(60) },
      ]);

      expect(new Date((await ctx.repo().lastJoinTime(ctx.memberIds[0]))!)).toEqual(new Date(at(60)));
      expect(new Date((await ctx.repo().lastJoinTime(ctx.memberIds[0], { before: at(45) }))!)).toEqual(new Date(at(30)));
      expect(await ctx.repo().lastJoinTime(ctx.memberIds[0], { before: at(-1) })).toBeNull();
      expect(await ctx.repo().lastJoinTime(ctx.memberIds[1])).toBeNull();
    });

    it("pages through more than a thousand records", async () => {
      await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ member: 0 as const, prickle: 0 as const, join: at(i / 60) })));

      expect(await ctx.repo().forPrickles([ctx.prickleIds[0]])).toHaveLength(1050);
      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(1050);
      expect((await ctx.repo().attendedPrickleIdsByMember()).get(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0]]));
    });
  });
}
