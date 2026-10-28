import { describe, it, expect, beforeEach } from "vitest";
import type { PrickleScheduleRepository, ScheduleRow } from "@/lib/data/prickle-schedules";

export type SeedSchedule = {
  key: string;
  host: 0 | 1;
  type?: 0 | 1;
  /** Index into the context's months. */
  month: 0 | 1 | 2;
  status?: "proposed" | "confirmed" | "declined";
  recurrence?: "weekly" | "one_off";
  deleted?: boolean;
  /** Rising numbers order the rows by creation. */
  created: number;
};

export type PrickleScheduleContractContext = {
  repo: () => PrickleScheduleRepository;
  /** Two members: names "Ada Example" (display name "Ada E.") and "Bo Example". */
  memberIds: readonly [string, string];
  typeIds: readonly [string, string];
  /** Their names (distinct). */
  typeNames: readonly [string, string];
  /** Three first-of-month dates no other test uses, oldest first. */
  months: readonly [string, string, string];
  /** An id no schedule has. */
  missingId: string;
  /** Replaces the two members' schedules with these; returns each one's id by its key. */
  seed: (rows: SeedSchedule[]) => Promise<Record<string, string>>;
  /** The two members' stored schedules, deleted ones included. */
  stored: () => Promise<ScheduleRow[]>;
};

/** Behavior every `PrickleScheduleRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function definePrickleScheduleContract(name: string, setup: () => PrickleScheduleContractContext) {
  describe(`${name} (PrickleScheduleRepository contract)`, () => {
    let ctx: PrickleScheduleContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const newRow = (month: string, over: Record<string, unknown> = {}) => ({
      host_id: ctx.memberIds[0],
      type_id: ctx.typeIds[0],
      month,
      recurrence_type: "weekly",
      day_of_week: 2,
      start_time_local: "19:00",
      ...over,
    });

    it("lists a host's live schedules in the given months, by month then creation, with type names", async () => {
      const [m0, m1, m2] = ctx.months;
      const ids = await ctx.seed([
        { key: "late", host: 0, month: 1, created: 1 },
        { key: "early-b", host: 0, type: 1, month: 0, created: 3 },
        { key: "early-a", host: 0, month: 0, created: 2 },
        { key: "deleted", host: 0, month: 0, created: 4, deleted: true },
        { key: "other-month", host: 0, month: 2, created: 5 },
        { key: "theirs", host: 1, month: 0, created: 6 },
      ]);

      const rows = await ctx.repo().ofHostInMonths(ctx.memberIds[0], [m0, m1]);

      expect(rows.map((r) => r.id)).toEqual([ids["early-a"], ids["early-b"], ids["late"]]);
      expect(rows.map((r) => r.typeName)).toEqual([ctx.typeNames[0], ctx.typeNames[1], ctx.typeNames[0]]);
      expect(rows[0]).toMatchObject({ host_id: ctx.memberIds[0], month: m0, recurrence_type: "weekly", day_of_week: 2, status: "proposed" });
      expect(await ctx.repo().ofHostInMonths(ctx.memberIds[0], [m2])).toHaveLength(1);
    });

    it("finds a host's latest month with a live schedule, ignoring deleted ones", async () => {
      await ctx.seed([
        { key: "a", host: 0, month: 0, created: 1 },
        { key: "b", host: 0, month: 1, created: 2 },
        { key: "gone", host: 0, month: 2, created: 3, deleted: true },
      ]);

      expect(await ctx.repo().latestMonthOf(ctx.memberIds[0])).toBe(ctx.months[1]);
      expect(await ctx.repo().latestMonthOf(ctx.memberIds[1])).toBeNull();
    });

    it("counts a host's live confirmed schedules", async () => {
      await ctx.seed([
        { key: "a", host: 0, month: 0, created: 1, status: "confirmed" },
        { key: "b", host: 0, month: 1, created: 2, status: "confirmed" },
        { key: "proposed", host: 0, month: 1, created: 3 },
        { key: "declined", host: 0, month: 1, created: 4, status: "declined" },
        { key: "gone", host: 0, month: 2, created: 5, status: "confirmed", deleted: true },
        { key: "theirs", host: 1, month: 0, created: 6, status: "confirmed" },
      ]);

      expect(await ctx.repo().confirmedCountOf(ctx.memberIds[0])).toBe(2);
      expect(await ctx.repo().confirmedCountOf(ctx.memberIds[1])).toBe(1);
    });

    it("lists a month's proposed and confirmed slots with type and host names", async () => {
      const ids = await ctx.seed([
        { key: "proposed", host: 0, type: 0, month: 0, created: 1 },
        { key: "confirmed", host: 1, type: 1, month: 0, created: 2, status: "confirmed", recurrence: "one_off" },
        { key: "declined", host: 0, month: 0, created: 3, status: "declined" },
        { key: "gone", host: 0, month: 0, created: 4, deleted: true },
        { key: "elsewhere", host: 0, month: 1, created: 5 },
      ]);

      const slots = await ctx.repo().slotsOfMonth(ctx.months[0]);

      expect(slots.map((s) => s.id).sort()).toEqual([ids.proposed, ids.confirmed].sort());
      const proposed = slots.find((s) => s.id === ids.proposed)!;
      expect(proposed).toMatchObject({ typeName: ctx.typeNames[0], status: "proposed", recurrence_type: "weekly", day_of_week: 2, timezone: expect.any(String) });
      expect(proposed.host?.name).toContain("Ada Example");
      const confirmed = slots.find((s) => s.id === ids.confirmed)!;
      expect(confirmed).toMatchObject({ typeName: ctx.typeNames[1], status: "confirmed", recurrence_type: "one_off" });
      expect(confirmed.event_date).not.toBeNull();
      expect(confirmed.host?.name).toContain("Bo Example");
    });

    it("lists a month's live schedules in any status by creation, with host and type joined for the admin list", async () => {
      const ids = await ctx.seed([
        { key: "second", host: 1, type: 1, month: 0, created: 2, status: "declined" },
        { key: "first", host: 0, month: 0, created: 1 },
        { key: "gone", host: 0, month: 0, created: 3, deleted: true },
        { key: "elsewhere", host: 0, month: 1, created: 4 },
      ]);

      expect((await ctx.repo().liveInMonth(ctx.months[0])).filter((r) => [ids.first, ids.second, ids.gone].includes(r.id)).map((r) => r.id)).toEqual([ids.first, ids.second]);

      const details = (await ctx.repo().detailsOfMonth(ctx.months[0])).filter((r) => [ids.first, ids.second, ids.gone].includes(r.id));
      expect(details.map((r) => r.id)).toEqual([ids.first, ids.second]);
      expect(details[0].member).toMatchObject({ id: ctx.memberIds[0] });
      expect(details[0].member?.name).toContain("Ada Example");
      expect(details[0].prickle_type).toEqual({ id: ctx.typeIds[0], name: ctx.typeNames[0] });
      expect(details[1].member?.id).toBe(ctx.memberIds[1]);
      expect(details[1].prickle_type?.id).toBe(ctx.typeIds[1]);
    });

    it("finds a live schedule by id, and nothing for a deleted or unknown one", async () => {
      const ids = await ctx.seed([
        { key: "live", host: 0, month: 1, created: 1 },
        { key: "gone", host: 0, month: 1, created: 2, deleted: true },
      ]);

      expect(await ctx.repo().liveById(ids.live)).toEqual({ id: ids.live, host_id: ctx.memberIds[0], month: ctx.months[1] });
      expect(await ctx.repo().liveById(ids.gone)).toBeNull();
      expect(await ctx.repo().liveById(ctx.missingId)).toBeNull();
    });

    it("inserts several schedules at once, with the defaults of a request, and nothing for none", async () => {
      await ctx.seed([]);
      await ctx.repo().insert([]);
      expect(await ctx.stored()).toEqual([]);

      await ctx.repo().insert([newRow(ctx.months[0]), newRow(ctx.months[1], { host_id: ctx.memberIds[1], recurrence_type: "one_off", day_of_week: null, event_date: `${ctx.months[1].slice(0, 8)}15`, notes: "Hi" })]);

      const stored = await ctx.stored();
      expect(stored).toHaveLength(2);
      expect(stored.find((r) => r.host_id === ctx.memberIds[0])).toMatchObject({ status: "proposed", deleted_at: null, notes: null, carried_forward_from: null, confirmed_at: null });
      expect(stored.find((r) => r.host_id === ctx.memberIds[1])).toMatchObject({ recurrence_type: "one_off", notes: "Hi" });
    });

    it("rejects an insert that breaks a rule, leaving nothing behind", async () => {
      await ctx.seed([]);

      await expect(ctx.repo().insert([newRow(ctx.months[0]), newRow(ctx.months[1], { type_id: ctx.missingId })])).rejects.toThrow();
      expect(await ctx.stored()).toEqual([]);
    });

    it("inserts one schedule and returns it with host and type joined in", async () => {
      await ctx.seed([]);

      const created = await ctx.repo().insertDetailed(newRow(ctx.months[2], { status: "confirmed", notes: "Admin note" }));

      expect(created).toMatchObject({ host_id: ctx.memberIds[0], type_id: ctx.typeIds[0], month: ctx.months[2], status: "confirmed", notes: "Admin note" });
      expect(created.member?.id).toBe(ctx.memberIds[0]);
      expect(created.prickle_type).toEqual({ id: ctx.typeIds[0], name: ctx.typeNames[0] });
      expect((await ctx.stored()).map((r) => r.id)).toEqual([created.id]);
      await expect(ctx.repo().insertDetailed(newRow(ctx.months[2], { type_id: ctx.missingId }))).rejects.toThrow();
    });

    it("updates a schedule by id, or only the host's own when scoped to a host", async () => {
      const ids = await ctx.seed([{ key: "mine", host: 0, month: 1, created: 1 }]);

      await ctx.repo().update(ids.mine, { notes: "not theirs" }, { hostId: ctx.memberIds[1] });
      expect((await ctx.stored())[0].notes).toBeNull();

      await ctx.repo().update(ids.mine, { notes: "mine", start_time_local: "20:30" }, { hostId: ctx.memberIds[0] });
      expect((await ctx.stored())[0]).toMatchObject({ notes: "mine" });

      await ctx.repo().update(ids.mine, { day_of_week: 4 });
      expect((await ctx.stored())[0]).toMatchObject({ notes: "mine", day_of_week: 4 });

      await expect(ctx.repo().update(ids.mine, { status: "bogus" })).rejects.toThrow();
    });

    it("soft deletes through an update: the schedule disappears from the live lists but stays stored", async () => {
      const ids = await ctx.seed([{ key: "a", host: 0, month: 1, created: 1 }]);

      await ctx.repo().update(ids.a, { deleted_at: "2099-01-01T00:00:00Z" }, { hostId: ctx.memberIds[0] });

      expect(await ctx.repo().liveById(ids.a)).toBeNull();
      expect(await ctx.repo().ofHostInMonths(ctx.memberIds[0], [ctx.months[1]])).toEqual([]);
      expect(await ctx.stored()).toHaveLength(1);
    });

    it("updates a live schedule and returns it joined, or null when there is none", async () => {
      const ids = await ctx.seed([
        { key: "live", host: 1, type: 1, month: 0, created: 1 },
        { key: "gone", host: 0, month: 0, created: 2, deleted: true },
      ]);

      const updated = await ctx.repo().updateLive(ids.live, { status: "confirmed", notes: "Confirmed" });

      expect(updated).toMatchObject({ id: ids.live, status: "confirmed", notes: "Confirmed" });
      expect(updated?.member?.id).toBe(ctx.memberIds[1]);
      expect(updated?.prickle_type?.id).toBe(ctx.typeIds[1]);
      expect(await ctx.repo().updateLive(ids.gone, { notes: "x" })).toBeNull();
      expect(await ctx.repo().updateLive(ctx.missingId, { notes: "x" })).toBeNull();
      expect((await ctx.stored()).find((r) => r.id === ids.gone)?.notes).toBeNull();
      await expect(ctx.repo().updateLive(ids.live, { status: "bogus" })).rejects.toThrow();
    });

    it("confirms only the proposed ones among the given schedules", async () => {
      const ids = await ctx.seed([
        { key: "proposed", host: 0, month: 0, created: 1 },
        { key: "declined", host: 0, month: 1, created: 2, status: "declined" },
        { key: "untouched", host: 1, month: 0, created: 3 },
      ]);

      await ctx.repo().confirmProposed([ids.proposed, ids.declined], { confirmedBy: null, at: "2099-02-01T00:00:00Z" });
      await ctx.repo().confirmProposed([], { confirmedBy: null, at: "2099-02-01T00:00:00Z" });

      const byId = new Map((await ctx.stored()).map((r) => [r.id, r]));
      expect(byId.get(ids.proposed)).toMatchObject({ status: "confirmed", confirmed_by: null });
      expect(new Date(byId.get(ids.proposed)!.confirmed_at!).toISOString()).toBe("2099-02-01T00:00:00.000Z");
      expect(byId.get(ids.declined)).toMatchObject({ status: "declined", confirmed_at: null });
      expect(byId.get(ids.untouched)).toMatchObject({ status: "proposed" });
    });

    it("confirms a long list of schedules past the id chunk size", async () => {
      await ctx.seed([]);
      await ctx.repo().insert(Array.from({ length: 205 }, () => newRow(ctx.months[0])));
      const proposed = (await ctx.stored()).map((r) => r.id);

      await ctx.repo().confirmProposed(proposed, { confirmedBy: null, at: "2099-02-01T00:00:00Z" });

      expect((await ctx.stored()).every((r) => r.status === "confirmed")).toBe(true);
    });

    it("hands every schedule of one host to another", async () => {
      await ctx.seed([
        { key: "a", host: 0, month: 0, created: 1 },
        { key: "b", host: 0, month: 1, created: 2, deleted: true },
        { key: "c", host: 1, month: 0, created: 3 },
      ]);

      await ctx.repo().reassignHost(ctx.memberIds[0], ctx.memberIds[1]);

      expect((await ctx.stored()).every((r) => r.host_id === ctx.memberIds[1])).toBe(true);
    });
  });
}
