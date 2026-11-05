import { beforeEach, describe, expect, it } from "vitest";
import type { LogRecipient, NotificationLogRepository } from "@/lib/data/notification-log";

export type NotificationLogContractContext = {
  repo: () => NotificationLogRepository;
  /** Two members that exist, for the member recipients. */
  memberIds: [string, string];
  /** A place name no other test or run uses. */
  place: () => string;
  /** Removes everything this suite wrote. */
  reset: () => Promise<void>;
};

const NOW = new Date("2026-11-04T14:00:00Z");

/** Behavior every `NotificationLogRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineNotificationLogContract(name: string, setup: () => NotificationLogContractContext) {
  describe(`${name} (NotificationLogRepository contract)`, () => {
    let ctx: NotificationLogContractContext;
    let alice: LogRecipient;
    let bob: LogRecipient;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
      alice = { memberId: ctx.memberIds[0] };
      bob = { memberId: ctx.memberIds[1] };
    });

    it("gives a claim to one caller and refuses the same kind and key again", async () => {
      const repo = ctx.repo();
      expect(await repo.claim(alice, "digest", "entry-a", NOW)).toBe(true);
      expect(await repo.claim(alice, "digest", "entry-a", NOW)).toBe(false);
    });

    it("keeps recipients, kinds and keys apart", async () => {
      const repo = ctx.repo();
      expect(await repo.claim(alice, "digest", "entry-a", NOW)).toBe(true);
      expect(await repo.claim(bob, "digest", "entry-a", NOW)).toBe(true);
      expect(await repo.claim(alice, "other", "entry-a", NOW)).toBe(true);
      expect(await repo.claim(alice, "digest", "entry-b", NOW)).toBe(true);
    });

    it("lets only one of simultaneous callers win", async () => {
      const repo = ctx.repo();
      const results = await Promise.all(Array.from({ length: 5 }, () => repo.claim(alice, "digest", "entry-a", NOW)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("treats a shared place like any other recipient", async () => {
      const repo = ctx.repo();
      const place = { place: ctx.place() };
      expect(await repo.claim(place, "digest", "entry-a", NOW)).toBe(true);
      expect(await repo.claim(place, "digest", "entry-a", NOW)).toBe(false);
      expect(await repo.claim(alice, "digest", "entry-a", NOW)).toBe(true);
    });

    it("lists the keys sent of a kind, by recipient, leaving out those with none", async () => {
      const repo = ctx.repo();
      const place = { place: ctx.place() };
      await repo.claim(alice, "digest", "entry-a", NOW);
      await repo.claim(alice, "digest", "entry-b", NOW);
      await repo.claim(alice, "other", "entry-z", NOW);
      await repo.claim(place, "digest", "entry-c", NOW);
      const sent = await repo.sentKeys("digest", [alice, bob, place]);
      expect([...(sent.get(ctx.memberIds[0]) ?? [])].sort()).toEqual(["entry-a", "entry-b"]);
      expect(sent.has(ctx.memberIds[1])).toBe(false);
      expect([...(sent.get(place.place) ?? [])]).toEqual(["entry-c"]);
    });

    it("gives a claim back so the send can be tried again", async () => {
      const repo = ctx.repo();
      await repo.claim(alice, "digest", "entry-a", NOW);
      await repo.release(alice, "digest", "entry-a");
      expect((await repo.sentKeys("digest", [alice])).size).toBe(0);
      expect(await repo.claim(alice, "digest", "entry-a", NOW)).toBe(true);
    });
  });
}
