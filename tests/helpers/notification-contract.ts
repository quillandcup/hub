import { describe, it, expect, beforeEach } from "vitest";
import type { NotificationRepository } from "@/lib/data/notifications";

/** A stored override, for the context's member `member` (0 or 1). */
export type PreferenceSeed = { member: 0 | 1; kind: string; channel: string; enabled: boolean };

/** An in-app notification, for the context's member `member`; `minute` orders them (a later minute is newer). */
export type InAppSeed = { member: 0 | 1; kind: string; minute: number; ref?: string; text?: string; read?: boolean; bannerUntil?: string };

export type NotificationContractContext = {
  repo: () => NotificationRepository;
  /** Two members the seeds can belong to. */
  memberIds: readonly [string, string];
  /** Replace both members' preferences and in-app notifications with these; returns the notification ids in order. */
  seed: (data: { preferences?: PreferenceSeed[]; inApp?: InAppSeed[] }) => Promise<string[]>;
};

/** Behavior every `NotificationRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineNotificationContract(name: string, setup: () => NotificationContractContext) {
  describe(`${name} (NotificationRepository contract)`, () => {
    let ctx: NotificationContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists a member's stored preferences, and one kind's across several members", async () => {
      await ctx.seed({
        preferences: [
          { member: 0, kind: "prickle_checkin", channel: "email", enabled: true },
          { member: 0, kind: "prickle_checkin", channel: "slack", enabled: false },
          { member: 0, kind: "intro_nudge", channel: "slack", enabled: false },
          { member: 1, kind: "prickle_checkin", channel: "in_app", enabled: true },
        ],
      });
      const [a, b] = ctx.memberIds;

      const mine = await ctx.repo().preferencesOf(a);
      const byMember = await ctx.repo().preferencesForKind("prickle_checkin", [a, b, "mbr_ZZZZZZZZZZZZ"]);

      expect(mine.map((p) => `${p.kind}/${p.channel}/${p.enabled}`).sort()).toEqual(
        ["intro_nudge/slack/false", "prickle_checkin/email/true", "prickle_checkin/slack/false"].sort(),
      );
      expect(byMember.get(a)?.map((p) => p.channel).sort()).toEqual(["email", "slack"]);
      expect(byMember.get(b)).toEqual([{ memberId: b, kind: "prickle_checkin", channel: "in_app", enabled: true }]);
      expect(byMember.has("mbr_ZZZZZZZZZZZZ")).toBe(false);
      expect(await ctx.repo().preferencesForKind("prickle_checkin", [])).toEqual(new Map());
    });

    it("stores a choice once per kind and channel, replacing the earlier one", async () => {
      await ctx.seed({});
      const [a] = ctx.memberIds;

      await ctx.repo().setPreference(a, "prickle_checkin", "email", true);
      await ctx.repo().setPreference(a, "prickle_checkin", "email", false);
      await ctx.repo().setPreference(a, "prickle_checkin", "slack", true);

      const stored = await ctx.repo().preferencesOf(a);
      expect(stored).toHaveLength(2);
      expect(stored.find((p) => p.channel === "email")?.enabled).toBe(false);
    });

    it("adds an unread notification and lists the newest first", async () => {
      await ctx.seed({});
      const [a] = ctx.memberIds;

      await ctx.repo().addInApp({ memberId: a, kind: "prickle_checkin", ref: "prkl_AAAAAAAAAAA1", text: "Ready?", url: "/prickles/prkl_AAAAAAAAAAA1", bannerUntil: null });

      const [added] = await ctx.repo().inAppLatest(a, 10);
      expect(added).toMatchObject({ memberId: a, kind: "prickle_checkin", ref: "prkl_AAAAAAAAAAA1", text: "Ready?", url: "/prickles/prkl_AAAAAAAAAAA1", bannerUntil: null, readAt: null });
      expect(added.id).toBeTruthy();
    });

    it("lists a member's newest notifications first, only theirs, and only the unread ones when asked", async () => {
      const [old, mid, newest, theirs] = await ctx.seed({
        inApp: [
          { member: 0, kind: "a", minute: 1, read: true },
          { member: 0, kind: "b", minute: 2 },
          { member: 0, kind: "a", minute: 3 },
          { member: 1, kind: "a", minute: 4 },
        ],
      });
      const [a] = ctx.memberIds;

      expect((await ctx.repo().inAppLatest(a, 10)).map((n) => n.id)).toEqual([newest, mid, old]);
      expect((await ctx.repo().inAppLatest(a, 2)).map((n) => n.id)).toEqual([newest, mid]);
      expect((await ctx.repo().inAppUnread(a, 10)).map((n) => n.id)).toEqual([newest, mid]);
      expect((await ctx.repo().inAppUnread(a, 1)).map((n) => n.id)).toEqual([newest]);
      expect(theirs).toBeTruthy();
    });

    it("counts a member's notifications, optionally only unread and/or of one kind", async () => {
      await ctx.seed({
        inApp: [
          { member: 0, kind: "a", minute: 1, read: true },
          { member: 0, kind: "b", minute: 2 },
          { member: 0, kind: "a", minute: 3 },
          { member: 1, kind: "a", minute: 4 },
        ],
      });
      const [a] = ctx.memberIds;

      expect(await ctx.repo().inAppCount(a)).toBe(3);
      expect(await ctx.repo().inAppCount(a, { unreadOnly: true })).toBe(2);
      expect(await ctx.repo().inAppCount(a, { kind: "a" })).toBe(2);
      expect(await ctx.repo().inAppCount(a, { kind: "a", unreadOnly: true })).toBe(1);
    });

    it("pages the inbox by date or kind, filtered, with newest first breaking ties", async () => {
      const [k1, k2, k3, k4] = await ctx.seed({
        inApp: [
          { member: 0, kind: "b", minute: 1 },
          { member: 0, kind: "a", minute: 2, read: true },
          { member: 0, kind: "b", minute: 3 },
          { member: 0, kind: "a", minute: 4 },
        ],
      });
      const [a] = ctx.memberIds;
      const page = async (over: Partial<Parameters<NotificationRepository["inAppPage"]>[1]>) =>
        (await ctx.repo().inAppPage(a, { unreadOnly: false, kind: null, sortBy: "created_at", ascending: false, offset: 0, limit: 10, ...over })).map((n) => n.id);

      expect(await page({})).toEqual([k4, k3, k2, k1]);
      expect(await page({ ascending: true })).toEqual([k1, k2, k3, k4]);
      expect(await page({ sortBy: "kind", ascending: true })).toEqual([k4, k2, k3, k1]); // a, a (newest first), b, b
      expect(await page({ unreadOnly: true })).toEqual([k4, k3, k1]);
      expect(await page({ kind: "a" })).toEqual([k4, k2]);
      expect(await page({ limit: 2, offset: 1 })).toEqual([k3, k2]);
    });

    it("finds one of the member's notifications by id, and not another member's", async () => {
      const [mine, theirs] = await ctx.seed({ inApp: [{ member: 0, kind: "a", minute: 1, ref: "r1" }, { member: 1, kind: "a", minute: 2 }] });
      const [a] = ctx.memberIds;

      expect(await ctx.repo().inAppById(a, mine)).toMatchObject({ id: mine, kind: "a", ref: "r1" });
      expect(await ctx.repo().inAppById(a, theirs)).toBeNull();
    });

    it("marks some read and back to unread, scoped to the member", async () => {
      const [first, second, theirs] = await ctx.seed({
        inApp: [{ member: 0, kind: "a", minute: 1 }, { member: 0, kind: "a", minute: 2 }, { member: 1, kind: "a", minute: 3 }],
      });
      const [a, b] = ctx.memberIds;

      await ctx.repo().markInAppRead(a, [first, theirs]); // theirs isn't a's: untouched
      expect((await ctx.repo().inAppUnread(a, 10)).map((n) => n.id)).toEqual([second]);
      expect(await ctx.repo().inAppCount(b, { unreadOnly: true })).toBe(1);

      await ctx.repo().markInAppUnread(a, [first]);
      expect(await ctx.repo().inAppCount(a, { unreadOnly: true })).toBe(2);
    });

    it("marks every one of a member's notifications read", async () => {
      await ctx.seed({ inApp: [{ member: 0, kind: "a", minute: 1 }, { member: 0, kind: "b", minute: 2 }, { member: 1, kind: "a", minute: 3 }] });
      const [a, b] = ctx.memberIds;

      await ctx.repo().markAllInAppRead(a);

      expect(await ctx.repo().inAppCount(a, { unreadOnly: true })).toBe(0);
      expect(await ctx.repo().inAppCount(b, { unreadOnly: true })).toBe(1);
    });

    it("resolves the unread notifications of a kind about a ref, and only those", async () => {
      const [hit, otherKind, otherRef, alreadyRead] = await ctx.seed({
        inApp: [
          { member: 0, kind: "prickle_checkin", minute: 1, ref: "r1" },
          { member: 0, kind: "prickle_checkout", minute: 2, ref: "r1" },
          { member: 0, kind: "prickle_checkin", minute: 3, ref: "r2" },
          { member: 0, kind: "prickle_checkin", minute: 4, ref: "r1", read: true },
        ],
      });
      const [a] = ctx.memberIds;

      await ctx.repo().resolveInApp(a, "prickle_checkin", "r1");

      expect((await ctx.repo().inAppUnread(a, 10)).map((n) => n.id).sort()).toEqual([otherKind, otherRef].sort());
      expect(await ctx.repo().inAppById(a, hit)).toMatchObject({ readAt: expect.any(String) });
      expect(alreadyRead).toBeTruthy();
    });
  });
}
