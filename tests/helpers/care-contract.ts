import { describe, it, expect, beforeEach } from "vitest";
import type { CareRepository } from "@/lib/data/care";

export type CareContractContext = {
  repo: () => CareRepository;
  /** Three members: "Ada Example" (display name "Ada E."), "Bo Example" and "Cy Example". */
  members: readonly { id: string; name: string }[];
  /** The staff account that opens engagements (an auth user id), or null for none. */
  openedBy: string | null;
  /** A second staff account, to hand engagements to; null when the context has none (every owner then is `openedBy`). */
  otherOwner: string | null;
  /** An engagement id nothing has. */
  missingId: string;
  /** Removes every engagement of the three members. */
  clear: () => Promise<void>;
};

/** A stored instant as an ISO string: Postgres answers "+00:00", the twin keeps what it was given. */
const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/** Behavior every `CareRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCareContract(name: string, setup: () => CareContractContext) {
  describe(`${name} (CareRepository contract)`, () => {
    let ctx: CareContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const id = (i: number) => ctx.members[i].id;
    const open = (member: number, over: Partial<Parameters<CareRepository["open"]>[0]> = {}) =>
      ctx.repo().open({
        memberId: id(member),
        reason: "check_in",
        periodEndsOn: "2026-03-31",
        openedBy: ctx.openedBy,
        openedAt: "2026-03-01T15:00:00.000Z",
        ...over,
      });
    const opened = async (member: number, over: Partial<Parameters<CareRepository["open"]>[0]> = {}) => {
      const result = await open(member, over);
      if (!result.ok) throw new Error("expected the engagement to open");
      return result.engagement;
    };
    const renewInput = { periodEndsOn: "2026-05-01", at: "2026-04-02T12:00:00.000Z", reason: "she answered and we have a plan" };

    describe("opening", () => {
      it("opens an engagement she started: open, with her message at the start and the period's last day", async () => {
        const c = await opened(ada, { notes: "said hello", nextStep: "ask about the draft", followUpOn: "2026-03-08" });

        expect(c).toMatchObject({
          member_id: id(ada),
          reason: "check_in",
          opened_by: ctx.openedBy,
          owned_by: ctx.openedBy,
          period_ends_on: "2026-03-31",
          renewed_from: null,
          closed_at: null,
          ended_how: null,
          last_member_message_at: null,
          notes: "said hello",
          next_step: "ask about the draft",
          follow_up_on: "2026-03-08",
          deleted_at: null,
        });
        expect(iso(c.last_staff_message_at)).toBe("2026-03-01T15:00:00.000Z");
        expect(c.id).toMatch(/^care_[1-9A-HJ-NP-Za-km-z]{12}$/);
      });

      it("puts the first message where it is told to, which is the start of an earlier day for a care plan entered after the fact", async () => {
        const hers = await opened(ada, { openedAt: "2026-03-01T17:00:00.000Z", firstMessageAt: "2026-03-01T05:00:00.000Z" });
        const theirs = await opened(bo, { openedAt: "2026-03-01T17:00:00.000Z", firstMessageAt: "2026-03-01T05:00:00.000Z", firstMessageFrom: "member" });

        expect(iso(hers.opened_at)).toBe("2026-03-01T17:00:00.000Z");
        expect(iso(hers.last_staff_message_at)).toBe("2026-03-01T05:00:00.000Z");
        expect(iso(theirs.last_member_message_at)).toBe("2026-03-01T05:00:00.000Z");
        expect(theirs.last_staff_message_at).toBeNull();
      });

      it("opens one the member started: their message at the start, not hers", async () => {
        const c = await opened(bo, { firstMessageFrom: "member" });

        expect(iso(c.last_member_message_at)).toBe("2026-03-01T15:00:00.000Z");
        expect(c.last_staff_message_at).toBeNull();
      });

      it("keeps one open care plan per member, and answers with the one that is open", async () => {
        const first = await opened(ada);

        const again = await open(ada, { reason: "welcome" });
        expect(again).toMatchObject({ ok: false, reason: "already_open" });
        if (again.ok) throw new Error("unreachable");
        expect(again.engagement.id).toBe(first.id);
        expect(again.engagement.reason).toBe("check_in");
        expect(await ctx.repo().forMember(id(ada))).toHaveLength(1);
      });

      it("lets another member have one while this one is open", async () => {
        await opened(ada);
        expect((await open(bo)).ok).toBe(true);
      });

      it("lets a new one open once the old one is closed or removed", async () => {
        const first = await opened(ada);
        await ctx.repo().close(first.id, "no_reply", "2026-03-10T12:00:00.000Z");
        const second = await opened(ada);
        await ctx.repo().softDelete(second.id, "2026-03-11T12:00:00.000Z");

        expect((await open(ada)).ok).toBe(true);
      });

      it("refuses a reason outside the set, text over the limits, a bad date and a member nobody has", async () => {
        await expect(open(ada, { reason: "gossip" })).rejects.toThrow();
        await expect(open(ada, { notes: "x".repeat(1001) })).rejects.toThrow();
        await expect(open(ada, { nextStep: "x".repeat(281) })).rejects.toThrow();
        await expect(open(ada, { periodEndsOn: "next month" })).rejects.toThrow();
        await expect(open(ada, { memberId: "mbr_ZZZZZZZZZZZZ" })).rejects.toThrow();
        expect(await ctx.repo().forMember(id(ada))).toEqual([]);
      });
    });

    describe("renewing", () => {
      it("closes the period as renewed and opens the next one, linked, keeping reason, owner and who spoke last, with why as its note", async () => {
        const first = await opened(ada, { notes: "first period", nextStep: "write back", followUpOn: "2026-03-08" });
        await ctx.repo().logMessage(first.id, "member", "2026-03-20T10:00:00.000Z");

        const result = await ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("unreachable");
        const next = result.engagement;
        expect(next).toMatchObject({
          member_id: id(ada),
          reason: "check_in",
          opened_by: ctx.openedBy,
          owned_by: ctx.openedBy,
          period_ends_on: "2026-05-01",
          renewed_from: first.id,
          closed_at: null,
          ended_how: null,
          notes: "she answered and we have a plan",
          next_step: null,
          follow_up_on: null,
          deleted_at: null,
        });
        expect(iso(next.opened_at)).toBe("2026-04-02T12:00:00.000Z");
        expect(iso(next.last_member_message_at)).toBe("2026-03-20T10:00:00.000Z");
        expect(iso(next.last_staff_message_at)).toBe("2026-03-01T15:00:00.000Z");
        expect(next.id).not.toBe(first.id);

        const old = await ctx.repo().byId(first.id);
        expect(old).toMatchObject({ ended_how: "renewed", notes: "first period" });
        expect(iso(old!.closed_at)).toBe("2026-04-02T12:00:00.000Z");
        expect((await ctx.repo().forMember(id(ada))).map((c) => c.id)).toEqual([next.id, first.id]);
      });

      it("is safe against a double click: the second renewal finds nothing open and opens nothing", async () => {
        const first = await opened(ada);

        const [a, b] = await Promise.all([
          ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy }),
          ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy }),
        ]);

        expect([a.ok, b.ok].sort()).toEqual([false, true]);
        const all = await ctx.repo().forMember(id(ada));
        expect(all).toHaveLength(2);
        expect(all.filter((c) => c.closed_at === null)).toHaveLength(1);
      });

      it("answers not_open for one that is closed, removed or that nobody has", async () => {
        const closed = await opened(ada);
        await ctx.repo().close(closed.id, "no_reply", "2026-03-04T10:00:00.000Z");
        const removed = await opened(bo);
        await ctx.repo().softDelete(removed.id, "2026-03-04T10:00:00.000Z");

        for (const target of [closed.id, removed.id, ctx.missingId]) {
          expect(await ctx.repo().renew(target, { ...renewInput, openedBy: ctx.openedBy })).toEqual({ ok: false, reason: "not_open" });
        }
        expect(await ctx.repo().forMember(id(ada))).toHaveLength(1);
      });

      it("can be renewed again: the chain of periods is one link at a time", async () => {
        const first = await opened(ada);
        const second = await ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy });
        if (!second.ok) throw new Error("unreachable");
        const third = await ctx.repo().renew(second.engagement.id, { ...renewInput, periodEndsOn: "2026-06-01", at: "2026-05-02T12:00:00.000Z", openedBy: ctx.openedBy });

        expect(third).toMatchObject({ ok: true, engagement: { renewed_from: second.engagement.id, period_ends_on: "2026-06-01" } });
      });
    });

    describe("changing the start", () => {
      const noon = (day: string) => `${day}T17:00:00.000Z`; // noon Eastern in winter

      it("moves the start and the last day with it, and the first message if it is the opening itself", async () => {
        const c = await opened(ada); // opened 2026-03-01 10:00 Eastern, last day 2026-03-31 (30 days)
        await ctx.repo().logMessage(c.id, "member", "2026-03-05T10:00:00.000Z");

        const result = await ctx.repo().changeStart(c.id, noon("2026-02-20"));

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("unreachable");
        expect(result).toMatchObject({ changed: true, engagement: { id: c.id, period_ends_on: "2026-03-22" } });
        expect(iso(result.engagement.opened_at)).toBe(noon("2026-02-20"));
        expect(iso(result.engagement.last_staff_message_at)).toBe("2026-02-20T05:00:00.000Z"); // the start of the new Eastern day
        expect(iso(result.engagement.last_member_message_at)).toBe("2026-03-05T10:00:00.000Z"); // hers to keep: not the opening
        const stored = await ctx.repo().byId(c.id);
        expect(iso(stored!.opened_at)).toBe(noon("2026-02-20"));
        expect(stored!.period_ends_on).toBe("2026-03-22");
      });

      it("keeps the period's own length, whatever the setting is now", async () => {
        const c = await opened(ada, { periodEndsOn: "2026-04-15" }); // 45 days from 2026-03-01

        const result = await ctx.repo().changeStart(c.id, noon("2026-02-01"));

        expect(result).toMatchObject({ ok: true, engagement: { period_ends_on: "2026-03-18" } });
      });

      it("can move a start later, and moves the opening message of a member who wrote first", async () => {
        const c = await opened(bo, { firstMessageFrom: "member" });

        const result = await ctx.repo().changeStart(c.id, noon("2026-03-03"));

        if (!result.ok) throw new Error("unreachable");
        expect(result.engagement.period_ends_on).toBe("2026-04-02");
        expect(iso(result.engagement.last_member_message_at)).toBe("2026-03-03T05:00:00.000Z");
        expect(result.engagement.last_staff_message_at).toBeNull();
      });

      it("moves a first message that was put at the start of its day, as opening an earlier day does", async () => {
        const c = await opened(ada, { openedAt: "2026-03-01T17:00:00.000Z", firstMessageAt: "2026-03-01T05:00:00.000Z" });

        const result = await ctx.repo().changeStart(c.id, noon("2026-02-20"));

        if (!result.ok) throw new Error("unreachable");
        expect(iso(result.engagement.last_staff_message_at)).toBe("2026-02-20T05:00:00.000Z");
      });

      it("changes nothing when it already started on that Eastern day, so the time of day stays", async () => {
        const c = await opened(ada);

        const result = await ctx.repo().changeStart(c.id, noon("2026-03-01"));

        expect(result).toMatchObject({ ok: true, changed: false });
        expect(iso((await ctx.repo().byId(c.id))!.opened_at)).toBe("2026-03-01T15:00:00.000Z");
      });

      it("changes a closed one too, as long as it still starts before it was closed", async () => {
        const c = await opened(ada);
        await ctx.repo().close(c.id, "no_reply", "2026-03-10T12:00:00.000Z");

        expect((await ctx.repo().changeStart(c.id, noon("2026-02-25"))).ok).toBe(true);
        expect(await ctx.repo().changeStart(c.id, noon("2026-03-11"))).toEqual({ ok: false, reason: "after_closed", limit: expect.any(String) });
        const refused = await ctx.repo().changeStart(c.id, noon("2026-03-11"));
        if (refused.ok || refused.reason === "not_found") throw new Error("unreachable");
        expect(iso(refused.limit)).toBe("2026-03-10T12:00:00.000Z");
      });

      it("will not start a renewal before the care plan it continues, or the earlier one after its renewal", async () => {
        const first = await opened(ada);
        const renewed = await ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy });
        if (!renewed.ok) throw new Error("unreachable");

        const before = await ctx.repo().changeStart(renewed.engagement.id, noon("2026-02-28"));
        expect(before).toMatchObject({ ok: false, reason: "before_previous" });
        if (before.ok || before.reason === "not_found") throw new Error("unreachable");
        expect(iso(before.limit)).toBe("2026-03-01T15:00:00.000Z");

        const after = await ctx.repo().changeStart(first.id, noon("2026-04-03"));
        expect(after).toMatchObject({ ok: false, reason: "after_renewal" });
        if (after.ok || after.reason === "not_found") throw new Error("unreachable");
        expect(iso(after.limit)).toBe("2026-04-02T12:00:00.000Z");

        // Nothing moved by the refusals; both can still move inside the chain's order.
        expect(iso((await ctx.repo().byId(renewed.engagement.id))!.opened_at)).toBe("2026-04-02T12:00:00.000Z");
        expect((await ctx.repo().changeStart(renewed.engagement.id, noon("2026-03-15"))).ok).toBe(true);
        expect((await ctx.repo().changeStart(first.id, noon("2026-02-15"))).ok).toBe(true);
      });

      it("lets a start land on its neighbour's own day, at that neighbour's moment when noon would put it out of order", async () => {
        const first = await opened(ada, { openedAt: "2026-03-01T15:00:00.000Z" }); // 10:00 Eastern
        const renewed = await ctx.repo().renew(first.id, { ...renewInput, at: "2026-04-02T14:00:00.000Z", openedBy: ctx.openedBy }); // 10:00 Eastern
        if (!renewed.ok) throw new Error("unreachable");

        const onRenewalDay = await ctx.repo().changeStart(first.id, noon("2026-04-02"));
        if (!onRenewalDay.ok) throw new Error("unreachable");
        expect(iso(onRenewalDay.engagement.opened_at)).toBe("2026-04-02T14:00:00.000Z");

        const onParentDay = await ctx.repo().changeStart(renewed.engagement.id, "2026-04-02T12:00:00.000Z"); // the day it already is: nothing to do
        expect(onParentDay).toMatchObject({ ok: true, changed: false });
      });

      it("does not let a removed neighbour in the chain stop it", async () => {
        const first = await opened(ada);
        const renewed = await ctx.repo().renew(first.id, { ...renewInput, openedBy: ctx.openedBy });
        if (!renewed.ok) throw new Error("unreachable");
        await ctx.repo().softDelete(first.id, "2026-04-03T12:00:00.000Z");

        expect((await ctx.repo().changeStart(renewed.engagement.id, noon("2026-02-01"))).ok).toBe(true);
      });

      it("answers not_found for one that is removed or that nobody has", async () => {
        const c = await opened(ada);
        await ctx.repo().softDelete(c.id, "2026-03-04T10:00:00.000Z");

        expect(await ctx.repo().changeStart(c.id, noon("2026-02-20"))).toEqual({ ok: false, reason: "not_found" });
        expect(await ctx.repo().changeStart(ctx.missingId, noon("2026-02-20"))).toEqual({ ok: false, reason: "not_found" });
      });

      it("leaves the one-open-per-member rule as it was", async () => {
        const c = await opened(ada);
        await ctx.repo().changeStart(c.id, noon("2026-02-20"));

        expect(await open(ada)).toMatchObject({ ok: false, reason: "already_open" });
        expect((await ctx.repo().byId(c.id))!.closed_at).toBeNull();
        expect((await ctx.repo().forMember(id(ada))).filter((x) => x.closed_at === null)).toHaveLength(1);
      });
    });

    describe("owners", () => {
      it("gives an engagement to whoever is named, or to whoever opened it, and a renewal keeps the owner", async () => {
        const other = ctx.otherOwner ?? ctx.openedBy;
        const own = await opened(ada);
        expect(own.owned_by).toBe(ctx.openedBy);

        const named = await opened(bo, { ownedBy: other });
        expect(named.owned_by).toBe(other);

        const renewed = await ctx.repo().renew(named.id, { ...renewInput, openedBy: ctx.openedBy });
        if (!renewed.ok) throw new Error("unreachable");
        expect(renewed.engagement.owned_by).toBe(other);

        const unowned = await opened(cy, { ownedBy: null });
        expect(unowned.owned_by).toBeNull();
      });

      it("reassigns an open or a closed engagement, and answers null for one that is gone", async () => {
        const other = ctx.otherOwner ?? ctx.openedBy;
        const c = await opened(ada);

        expect(await ctx.repo().reassign(c.id, other)).toMatchObject({ id: c.id, owned_by: other });
        expect((await ctx.repo().byId(c.id))?.owned_by).toBe(other);

        await ctx.repo().close(c.id, "ran_its_course", "2026-03-09T09:00:00.000Z");
        expect(await ctx.repo().reassign(c.id, ctx.openedBy)).toMatchObject({ owned_by: ctx.openedBy, ended_how: "ran_its_course" });

        expect(await ctx.repo().reassign(ctx.missingId, other)).toBeNull();
        await ctx.repo().softDelete(c.id, "2026-03-10T09:00:00.000Z");
        expect(await ctx.repo().reassign(c.id, other)).toBeNull();
      });
    });

    describe("renewing needs a reason that fits", () => {
      it("refuses a reason over the note's limit and leaves the engagement open", async () => {
        const first = await opened(ada);
        await expect(ctx.repo().renew(first.id, { ...renewInput, reason: "x".repeat(1001), openedBy: ctx.openedBy })).rejects.toThrow();
        expect((await ctx.repo().byId(first.id))?.closed_at).toBeNull();
        expect(await ctx.repo().forMember(id(ada))).toHaveLength(1);
      });
    });

    describe("logging messages", () => {
      it("sets who spoke last on an open engagement", async () => {
        const c = await opened(ada);

        const afterMember = await ctx.repo().logMessage(c.id, "member", "2026-03-02T10:00:00.000Z");
        expect([iso(afterMember!.last_member_message_at), iso(afterMember!.last_staff_message_at)]).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-01T15:00:00.000Z"]);

        const afterStaff = await ctx.repo().logMessage(c.id, "staff", "2026-03-03T10:00:00.000Z");
        expect([iso(afterStaff!.last_member_message_at), iso(afterStaff!.last_staff_message_at)]).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-03T10:00:00.000Z"]);
      });

      it("answers null for a closed engagement, a removed one or one nobody has", async () => {
        const closed = await opened(ada);
        await ctx.repo().close(closed.id, "ran_its_course", "2026-03-04T10:00:00.000Z");
        const removed = await opened(bo);
        await ctx.repo().softDelete(removed.id, "2026-03-04T10:00:00.000Z");

        expect(await ctx.repo().logMessage(closed.id, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
        expect(await ctx.repo().logMessage(removed.id, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
        expect(await ctx.repo().logMessage(ctx.missingId, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
      });
    });

    describe("moving message times forward (what Slack DMs derive)", () => {
      it("sets a time that is later than the stored one, or when none is stored, and says how many moved", async () => {
        const c = await opened(ada); // her message at the start; none from them

        expect(await ctx.repo().moveMessageTimesForward(c.id, { staffAt: "2026-03-02T10:00:00.000Z", memberAt: "2026-03-03T10:00:00.000Z" })).toBe(2);

        const after = (await ctx.repo().byId(c.id))!;
        expect([iso(after.last_staff_message_at), iso(after.last_member_message_at)]).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-03T10:00:00.000Z"]);
      });

      it("never moves a time back, and applying the same one twice changes nothing", async () => {
        const c = await opened(ada);
        await ctx.repo().logMessage(c.id, "member", "2026-03-05T10:00:00.000Z");

        expect(await ctx.repo().moveMessageTimesForward(c.id, { staffAt: "2026-03-01T09:00:00.000Z", memberAt: "2026-03-04T10:00:00.000Z" })).toBe(0);
        expect(await ctx.repo().moveMessageTimesForward(c.id, { memberAt: "2026-03-05T10:00:00.000Z" })).toBe(0);
        expect(await ctx.repo().moveMessageTimesForward(c.id, { staffAt: "2026-03-06T10:00:00.000Z" })).toBe(1);
        expect(await ctx.repo().moveMessageTimesForward(c.id, { staffAt: "2026-03-06T10:00:00.000Z" })).toBe(0);

        const after = (await ctx.repo().byId(c.id))!;
        expect([iso(after.last_staff_message_at), iso(after.last_member_message_at)]).toEqual(["2026-03-06T10:00:00.000Z", "2026-03-05T10:00:00.000Z"]);
      });

      it("moves only the side given, and nothing for no times", async () => {
        const c = await opened(ada);

        expect(await ctx.repo().moveMessageTimesForward(c.id, {})).toBe(0);
        expect(await ctx.repo().moveMessageTimesForward(c.id, { memberAt: "2026-03-02T10:00:00.000Z" })).toBe(1);

        const after = (await ctx.repo().byId(c.id))!;
        expect([iso(after.last_staff_message_at), iso(after.last_member_message_at)]).toEqual(["2026-03-01T15:00:00.000Z", "2026-03-02T10:00:00.000Z"]);
      });

      it("leaves a closed engagement, a removed one and one nobody has alone", async () => {
        const closed = await opened(ada);
        await ctx.repo().close(closed.id, "ran_its_course", "2026-03-04T10:00:00.000Z");
        const removed = await opened(bo);
        await ctx.repo().softDelete(removed.id, "2026-03-04T10:00:00.000Z");

        expect(await ctx.repo().moveMessageTimesForward(closed.id, { memberAt: "2026-03-05T10:00:00.000Z" })).toBe(0);
        expect(await ctx.repo().moveMessageTimesForward(removed.id, { memberAt: "2026-03-05T10:00:00.000Z" })).toBe(0);
        expect(await ctx.repo().moveMessageTimesForward(ctx.missingId, { memberAt: "2026-03-05T10:00:00.000Z" })).toBe(0);
        expect((await ctx.repo().byId(closed.id))!.last_member_message_at).toBeNull();
      });
    });

    describe("updating", () => {
      it("changes only what is given, and clears a field given null", async () => {
        const c = await opened(ada, { notes: "first", nextStep: "write back", followUpOn: "2026-03-08" });

        const edited = await ctx.repo().update(c.id, { notes: "second", followUpOn: null });
        expect(edited).toMatchObject({ notes: "second", next_step: "write back", follow_up_on: null, reason: "check_in" });

        const reasoned = await ctx.repo().update(c.id, { reason: "encouragement" });
        expect(reasoned).toMatchObject({ reason: "encouragement", notes: "second" });
      });

      it("returns the engagement as it is when there is nothing to change", async () => {
        const c = await opened(ada, { notes: "kept" });
        expect(await ctx.repo().update(c.id, {})).toMatchObject({ id: c.id, notes: "kept" });
      });

      it("answers null for one nobody has or that was removed, and refuses a bad reason or long text", async () => {
        const c = await opened(ada);
        expect(await ctx.repo().update(ctx.missingId, { notes: "x" })).toBeNull();

        await expect(ctx.repo().update(c.id, { reason: "gossip" })).rejects.toThrow();
        await expect(ctx.repo().update(c.id, { notes: "x".repeat(1001) })).rejects.toThrow();

        await ctx.repo().softDelete(c.id, "2026-03-04T10:00:00.000Z");
        expect(await ctx.repo().update(c.id, { notes: "x" })).toBeNull();
      });
    });

    describe("closing and removing", () => {
      it("closes an open engagement with how it ended, once", async () => {
        const c = await opened(ada);

        const closed = await ctx.repo().close(c.id, "back_in_community", "2026-03-09T09:00:00.000Z");
        expect(closed).toMatchObject({ id: c.id, ended_how: "back_in_community" });
        expect(iso(closed!.closed_at)).toBe("2026-03-09T09:00:00.000Z");

        expect(await ctx.repo().close(c.id, "no_reply", "2026-03-10T09:00:00.000Z")).toBeNull();
        expect(await ctx.repo().close(ctx.missingId, "no_reply", "2026-03-10T09:00:00.000Z")).toBeNull();
        expect((await ctx.repo().byId(c.id))?.ended_how).toBe("back_in_community");
      });

      it("refuses an ending outside the set and leaves it open", async () => {
        const c = await opened(ada);
        await expect(ctx.repo().close(c.id, "vanished", "2026-03-09T09:00:00.000Z")).rejects.toThrow();
        expect((await ctx.repo().byId(c.id))?.closed_at).toBeNull();
      });

      it("removes an engagement from every read, and says so when there was none", async () => {
        const c = await opened(ada);

        expect(await ctx.repo().softDelete(c.id, "2026-03-04T10:00:00.000Z")).toBe(true);
        expect(await ctx.repo().softDelete(c.id, "2026-03-05T10:00:00.000Z")).toBe(false);
        expect(await ctx.repo().softDelete(ctx.missingId, "2026-03-05T10:00:00.000Z")).toBe(false);

        expect(await ctx.repo().byId(c.id)).toBeNull();
        expect(await ctx.repo().forMember(id(ada))).toEqual([]);
        expect((await ctx.repo().list({ includeClosed: true })).filter((x) => x.id === c.id)).toEqual([]);
      });
    });

    describe("reading", () => {
      it("lists every open engagement, and the closed ones when asked, newest opened first, with the member joined in", async () => {
        const oldOpen = await opened(ada, { openedAt: "2026-01-05T12:00:00.000Z" });
        const newOpen = await opened(bo, { openedAt: "2026-03-05T12:00:00.000Z" });
        const closed = await opened(cy, { openedAt: "2026-02-20T12:00:00.000Z" });
        await ctx.repo().close(closed.id, "back_in_community", "2026-03-01T12:00:00.000Z");

        const mine = new Set([oldOpen.id, newOpen.id, closed.id]);
        const openOnly = (await ctx.repo().list()).filter((c) => mine.has(c.id));
        expect(openOnly.map((c) => c.id)).toEqual([newOpen.id, oldOpen.id]);

        const all = (await ctx.repo().list({ includeClosed: true })).filter((c) => mine.has(c.id));
        expect(all.map((c) => c.id)).toEqual([newOpen.id, closed.id, oldOpen.id]);
        expect(all[2].member).toEqual({ id: id(ada), name: ctx.members[ada].name, display_name: "Ada E." });
        expect(all[0].member).toEqual({ id: id(bo), name: ctx.members[bo].name, display_name: null });
      });

      it("finds one by id with its member, and one member's engagements newest first", async () => {
        const first = await opened(ada, { openedAt: "2026-01-05T12:00:00.000Z" });
        await ctx.repo().close(first.id, "ran_its_course", "2026-01-20T12:00:00.000Z");
        const second = await opened(ada, { openedAt: "2026-03-05T12:00:00.000Z" });
        await opened(bo);

        expect((await ctx.repo().byId(second.id))?.member).toMatchObject({ id: id(ada), display_name: "Ada E." });
        expect(await ctx.repo().byId(ctx.missingId)).toBeNull();
        expect((await ctx.repo().forMember(id(ada))).map((c) => c.id)).toEqual([second.id, first.id]);
      });
    });
  });
}
