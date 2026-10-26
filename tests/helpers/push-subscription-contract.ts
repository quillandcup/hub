import { describe, it, expect, beforeEach } from "vitest";
import type { PushSubscriptionRepository } from "@/lib/data/push-subscriptions";

export type PushContractContext = {
  repo: () => PushSubscriptionRepository;
  /** Two members the cases can use. */
  memberIds: readonly [string, string];
  /** A string no other run has used (endpoints are unique across the whole table). */
  unique: (label: string) => string;
  /** Remove every subscription of the context's members. */
  reset: () => Promise<void>;
};

/** Behavior every `PushSubscriptionRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function definePushSubscriptionContract(name: string, setup: () => PushContractContext) {
  describe(`${name} (PushSubscriptionRepository contract)`, () => {
    let ctx: PushContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
    });

    const save = async (member: 0 | 1, label: string) => {
      const endpoint = `https://push.example.test/${ctx.unique(label)}`;
      await ctx.repo().save({ memberId: ctx.memberIds[member], endpoint, p256dh: `p-${label}`, auth: `a-${label}`, userAgent: "Test Browser" });
      return endpoint;
    };
    const idOf = async (member: 0 | 1, endpoint: string) => (await ctx.repo().devices(ctx.memberIds[member])).find((d) => d.endpoint === endpoint)!.id;

    it("saves a browser and lists it as a live subscription and a device", async () => {
      const [a] = ctx.memberIds;
      const endpoint = await save(0, "phone");

      const live = await ctx.repo().live(a);
      const devices = await ctx.repo().devices(a);

      expect(live).toEqual([{ id: expect.any(String), endpoint, p256dh: "p-phone", auth: "a-phone" }]);
      expect(devices[0]).toMatchObject({ endpoint, userAgent: "Test Browser", lastSentAt: null, pausedAt: null });
      expect(devices[0].createdAt).toBeTruthy();
    });

    it("says which members can be reached, and none for those with nothing live", async () => {
      const [a, b] = ctx.memberIds;
      await save(0, "reach");

      expect(await ctx.repo().membersWithLive([a, b, "mbr_ZZZZZZZZZZZZ"])).toEqual(new Set([a]));
      expect(await ctx.repo().membersWithLive([])).toEqual(new Set());
    });

    it("lists devices newest first, including paused ones, never deleted ones", async () => {
      const [a] = ctx.memberIds;
      const first = await save(0, "first");
      const second = await save(0, "second");
      const third = await save(0, "third");
      await ctx.repo().pause(a, second, new Date().toISOString());
      await ctx.repo().removeByEndpoint(a, third, new Date().toISOString());

      const devices = await ctx.repo().devices(a);

      expect(devices.map((d) => d.endpoint)).toEqual([second, first]);
      expect(devices.find((d) => d.endpoint === second)?.pausedAt).not.toBeNull();
    });

    it("keeps a paused device out of the live list, and resumes it onto new keys", async () => {
      const [a] = ctx.memberIds;
      const endpoint = await save(0, "paused");
      await ctx.repo().pause(a, endpoint, new Date().toISOString());
      expect(await ctx.repo().live(a)).toEqual([]);
      expect(await ctx.repo().membersWithLive([a])).toEqual(new Set());

      const next = `https://push.example.test/${ctx.unique("renewed")}`;
      const resumed = await ctx.repo().resume(a, endpoint, { endpoint: next, p256dh: "p-new", auth: "a-new" });

      expect(resumed).toBe(true);
      expect(await ctx.repo().live(a)).toEqual([{ id: expect.any(String), endpoint: next, p256dh: "p-new", auth: "a-new" }]);
      expect(await ctx.repo().resume(a, "https://push.example.test/unknown", { endpoint: next, p256dh: "x", auth: "y" })).toBe(false);
    });

    it("never resumes or pauses a device the member turned off", async () => {
      const [a] = ctx.memberIds;
      const endpoint = await save(0, "off");
      await ctx.repo().removeByEndpoint(a, endpoint, new Date().toISOString());

      await ctx.repo().pause(a, endpoint, new Date().toISOString());
      const resumed = await ctx.repo().resume(a, endpoint, { endpoint: `https://push.example.test/${ctx.unique("x")}`, p256dh: "p", auth: "a" });

      expect(resumed).toBe(false);
      expect(await ctx.repo().live(a)).toEqual([]);
      expect(await ctx.repo().devices(a)).toEqual([]);
    });

    it("turns a device off by endpoint or by id, only for its own member", async () => {
      const [a, b] = ctx.memberIds;
      const byEndpoint = await save(0, "by-endpoint");
      const byId = await save(0, "by-id");
      const theirs = await save(1, "theirs");
      const at = new Date().toISOString();

      await ctx.repo().removeByEndpoint(a, byEndpoint, at);
      await ctx.repo().removeById(a, await idOf(0, byId), at);
      await ctx.repo().removeById(a, await idOf(1, theirs), at); // not a's: untouched
      await ctx.repo().removeByEndpoint(a, theirs, at); // not a's: untouched

      expect(await ctx.repo().devices(a)).toEqual([]);
      expect((await ctx.repo().live(b)).map((s) => s.endpoint)).toEqual([theirs]);
    });

    it("revives a removed browser when it is saved again, and moves it to the member who saved it", async () => {
      const [a, b] = ctx.memberIds;
      const endpoint = await save(0, "moves");
      await ctx.repo().removeByEndpoint(a, endpoint, new Date().toISOString());

      await ctx.repo().save({ memberId: b, endpoint, p256dh: "p2", auth: "a2", userAgent: null });

      expect(await ctx.repo().live(a)).toEqual([]);
      expect((await ctx.repo().live(b)).map((s) => s.endpoint)).toEqual([endpoint]);
      expect((await ctx.repo().devices(b))[0]).toMatchObject({ endpoint, userAgent: null });
    });

    it("stamps sends and drops subscriptions the push service says are gone", async () => {
      const [a] = ctx.memberIds;
      const sent = await save(0, "sent");
      const gone = await save(0, "gone");
      const ids = { sent: await idOf(0, sent), gone: await idOf(0, gone) };
      const at = "2026-10-20T12:00:00.000Z";

      await ctx.repo().markSent([ids.sent], at);
      await ctx.repo().markGone([ids.gone], at);
      await ctx.repo().markSent([], at);
      await ctx.repo().markGone([], at);

      const devices = await ctx.repo().devices(a);
      expect(devices.map((d) => d.endpoint)).toEqual([sent]);
      expect(new Date(devices[0].lastSentAt!)).toEqual(new Date(at));
      expect((await ctx.repo().live(a)).map((s) => s.endpoint)).toEqual([sent]);
    });
  });
}
