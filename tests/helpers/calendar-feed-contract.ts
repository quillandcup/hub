import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import type { CalendarFeedRepository } from "@/lib/data/calendar-feed";

export type CalendarFeedContractContext = {
  repo: () => CalendarFeedRepository;
  /** Two members that exist. */
  members: [string, string];
  /** Two prickle types that exist. */
  types: [{ id: string; name: string }, { id: string; name: string }];
  /** Two prickles that exist: the first of the first type, the second of the second type, with their start times. */
  prickles: [{ id: string; typeId: string; startTime: string }, { id: string; typeId: string; startTime: string }];
  /** Two events that exist and are visible (events run from a day to a day: YYYY-MM-DD). */
  events: [{ id: string; title: string; startsAt: string; endsAt: string }, { id: string; title: string; startsAt: string; endsAt: string }];
  /** Removes whatever earlier tests left for these members (tokens and items), so each test starts empty. */
  reset: () => Promise<void>;
};

const ET = "America/New_York";
/** A token as the app makes them: 32 hex characters. */
const newToken = () => randomBytes(16).toString("hex");

/** Behavior every `CalendarFeedRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCalendarFeedContract(name: string, setup: () => CalendarFeedContractContext) {
  describe(`${name} (CalendarFeedRepository contract)`, () => {
    let ctx: CalendarFeedContractContext;
    let m1: string;
    let m2: string;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
      [m1, m2] = ctx.members;
    });

    describe("tokens", () => {
      it("has no token until one is created, and creating keeps the first one", async () => {
        const repo = ctx.repo();
        expect(await repo.tokenOf(m1)).toBeNull();

        const first = newToken();
        await repo.createTokenIfMissing(m1, first);
        await repo.createTokenIfMissing(m1, newToken());

        expect(await repo.tokenOf(m1)).toBe(first);
        expect(await repo.tokenOf(m2)).toBeNull();
      });

      it("finds who a token belongs to, and nobody for one that was never issued", async () => {
        const repo = ctx.repo();
        const token = newToken();
        await repo.createTokenIfMissing(m1, token);

        expect(await repo.ownerOfToken(token)).toEqual({ memberId: m1, firstFetchedAt: null });
        expect(await repo.ownerOfToken(newToken())).toBeNull();
      });

      it("records the first fetch once, and a replaced token starts over", async () => {
        const repo = ctx.repo();
        const token = newToken();
        await repo.createTokenIfMissing(m1, token);
        expect(await repo.hasBeenFetched(m1)).toBe(false);

        await repo.recordFirstFetch(token, "2097-01-01T10:00:00.000Z");
        await repo.recordFirstFetch(token, "2097-02-02T10:00:00.000Z");
        expect(await repo.hasBeenFetched(m1)).toBe(true);
        expect(Date.parse((await repo.ownerOfToken(token))!.firstFetchedAt!)).toBe(Date.parse("2097-01-01T10:00:00.000Z"));

        const replacement = newToken();
        await repo.replaceToken(m1, replacement);
        expect(await repo.tokenOf(m1)).toBe(replacement);
        expect(await repo.ownerOfToken(token)).toBeNull();
        expect(await repo.ownerOfToken(replacement)).toEqual({ memberId: m1, firstFetchedAt: null });
        expect(await repo.hasBeenFetched(m1)).toBe(false);
      });

      it("replacing stores a token for a member who had none, and a member without a token has not been fetched", async () => {
        const repo = ctx.repo();
        expect(await repo.hasBeenFetched(m2)).toBe(false);
        const token = newToken();
        await repo.replaceToken(m2, token);
        expect(await repo.tokenOf(m2)).toBe(token);
      });
    });

    describe("items", () => {
      const slot = (typeId: string, dayOfWeek: number, startTimeLocal: string) => ({
        kind: "slot",
        type_id: typeId,
        day_of_week: dayOfWeek,
        start_time_local: startTimeLocal,
        timezone: ET,
      });

      it("adds a prickle, a weekly slot and an event, and says so when the member already has one", async () => {
        const repo = ctx.repo();
        const [p0] = ctx.prickles;
        const [t0] = ctx.types;
        const [e0] = ctx.events;

        expect(await repo.addItem(m1, null, { kind: "prickle", prickle_id: p0.id })).toBe("added");
        expect(await repo.addItem(m1, null, slot(t0.id, 1, "07:00"))).toBe("added");
        expect(await repo.addItem(m1, null, { kind: "event", event_id: e0.id })).toBe("added");

        expect(await repo.addItem(m1, null, { kind: "prickle", prickle_id: p0.id })).toBe("exists");
        expect(await repo.addItem(m1, null, slot(t0.id, 1, "07:00"))).toBe("exists");
        expect(await repo.addItem(m1, null, { kind: "event", event_id: e0.id })).toBe("exists");

        // Another weekday or time of day is another slot; another member can add the same things.
        expect(await repo.addItem(m1, null, slot(t0.id, 2, "07:00"))).toBe("added");
        expect(await repo.addItem(m1, null, slot(t0.id, 1, "08:00"))).toBe("added");
        expect(await repo.addItem(m2, null, { kind: "prickle", prickle_id: p0.id })).toBe("added");

        expect(await repo.countItems(m1)).toBe(5);
        expect(await repo.countItems(m2)).toBe(1);
      });

      it("lists a member's items as stored, ordered by id, with times as the database writes them", async () => {
        const repo = ctx.repo();
        const [p0] = ctx.prickles;
        const [t0] = ctx.types;
        const [e0] = ctx.events;
        await repo.addItem(m1, null, { kind: "prickle", prickle_id: p0.id });
        await repo.addItem(m1, null, slot(t0.id, 3, "07:30"));
        await repo.addItem(m1, null, { kind: "event", event_id: e0.id });
        await repo.addItem(m2, null, { kind: "prickle", prickle_id: p0.id });

        const items = await repo.itemsOf(m1);

        expect(items).toHaveLength(3);
        expect(items).toContainEqual({ kind: "prickle", prickle_id: p0.id, type_id: null, day_of_week: null, start_time_local: null, timezone: null, event_id: null });
        expect(items).toContainEqual({ kind: "slot", prickle_id: null, type_id: t0.id, day_of_week: 3, start_time_local: "07:30:00", timezone: ET, event_id: null });
        expect(items).toContainEqual({ kind: "event", prickle_id: null, type_id: null, day_of_week: null, start_time_local: null, timezone: null, event_id: e0.id });
        expect(await repo.itemsOf(m2)).toEqual([{ kind: "prickle", prickle_id: p0.id, type_id: null, day_of_week: null, start_time_local: null, timezone: null, event_id: null }]);
      });

      it("lists items with their type name, prickle and event, oldest added first", async () => {
        const repo = ctx.repo();
        const [p0, p1] = ctx.prickles;
        const [t0, t1] = ctx.types;
        const [e0] = ctx.events;
        await repo.addItem(m1, null, { kind: "event", event_id: e0.id });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await repo.addItem(m1, null, slot(t1.id, 4, "09:00"));
        await new Promise((resolve) => setTimeout(resolve, 5));
        await repo.addItem(m1, null, { kind: "prickle", prickle_id: p1.id });

        const listed = await repo.listedItemsOf(m1);

        expect(listed.map((i) => i.kind)).toEqual(["event", "slot", "prickle"]);
        expect(listed[0]).toMatchObject({ type_name: null, prickle: null });
        expect(listed[0].event!.starts_at).toBe(e0.startsAt);
        expect(listed[0].event!.ends_at).toBe(e0.endsAt);
        expect(listed[0].event!.title).toBe(e0.title);
        expect(listed[1]).toMatchObject({ type_id: t1.id, type_name: t1.name, day_of_week: 4, start_time_local: "09:00:00", prickle: null, event: null });
        expect(Date.parse(listed[2].prickle!.start_time)).toBe(Date.parse(p1.startTime));
        expect(listed[2].prickle!.type_name).toBe(t1.name);
        expect(listed[2]).toMatchObject({ type_name: null, event: null });
        expect(listed.every((i) => typeof i.id === "string" && Number.isFinite(Date.parse(i.created_at)))).toBe(true);
        // p0 and t0 were not added.
        expect(listed.some((i) => i.prickle_id === p0.id || i.type_id === t0.id)).toBe(false);
        expect(await repo.listedItemsOf(m2)).toEqual([]);
      });

      it("removes one of the member's items, and nobody else's", async () => {
        const repo = ctx.repo();
        const [p0] = ctx.prickles;
        await repo.addItem(m1, null, { kind: "prickle", prickle_id: p0.id });
        await repo.addItem(m2, null, { kind: "prickle", prickle_id: p0.id });
        const [mine] = await repo.listedItemsOf(m1);
        const [theirs] = await repo.listedItemsOf(m2);

        await repo.removeItem(m1, theirs.id); // not theirs to remove
        expect(await repo.countItems(m2)).toBe(1);

        await repo.removeItem(m1, mine.id);
        expect(await repo.countItems(m1)).toBe(0);
        await repo.removeItem(m1, mine.id); // already gone: nothing happens
        expect(await repo.countItems(m2)).toBe(1);
      });

      it("finds the members who added exactly this prickle, and those who added a weekly slot", async () => {
        const repo = ctx.repo();
        const [p0, p1] = ctx.prickles;
        const [t0, t1] = ctx.types;
        await repo.addItem(m1, null, { kind: "prickle", prickle_id: p0.id });
        await repo.addItem(m2, null, { kind: "prickle", prickle_id: p1.id });
        await repo.addItem(m1, null, slot(t0.id, 1, "07:00"));
        await repo.addItem(m2, null, slot(t0.id, 1, "09:30"));
        await repo.addItem(m2, null, slot(t0.id, 2, "07:00"));
        await repo.addItem(m2, null, slot(t1.id, 1, "07:00"));
        await repo.addItem(m2, null, { ...slot(t0.id, 1, "07:00"), timezone: "America/Los_Angeles" });

        expect(await repo.memberIdsWithPrickle(p0.id)).toEqual([m1]);
        expect(await repo.memberIdsWithPrickle(p1.id)).toEqual([m2]);

        const weekly = await repo.weeklySlotMembers({ typeId: t0.id, dayOfWeek: 1, timezone: ET });
        expect(weekly).toHaveLength(2);
        expect(weekly).toContainEqual({ memberId: m1, startTimeLocal: "07:00:00" });
        expect(weekly).toContainEqual({ memberId: m2, startTimeLocal: "09:30:00" });
        expect(await repo.weeklySlotMembers({ typeId: t1.id, dayOfWeek: 5, timezone: ET })).toEqual([]);
      });

      it("reads past 1000 items", { timeout: 120_000 }, async () => {
        const repo = ctx.repo();
        const [t0] = ctx.types;
        const times: string[] = [];
        for (let minute = 0; minute < 1001; minute++) times.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
        for (let i = 0; i < times.length; i += 50) {
          await Promise.all(times.slice(i, i + 50).map((time) => repo.addItem(m1, null, slot(t0.id, 6, time))));
        }

        expect(await repo.countItems(m1)).toBe(1001);
        expect(await repo.itemsOf(m1)).toHaveLength(1001);
        expect(await repo.listedItemsOf(m1)).toHaveLength(1001);
        expect(await repo.weeklySlotMembers({ typeId: t0.id, dayOfWeek: 6, timezone: ET })).toHaveLength(1001);
      });
    });
  });
}
