import { describe, it, expect, beforeEach } from "vitest";
import type { MemberStatusRepository } from "@/lib/data/member-status-overrides";

export type MemberStatusContractContext = {
  repo: () => MemberStatusRepository;
  /** Three members: "Ada Example" (display name "Ada E."), "Bo Example" and "Cy Example". Emails are `members[i].email`. */
  members: readonly { id: string; name: string; email: string }[];
  /** An auth user id (what `updated_by` and `created_by` point at). */
  userId: string;
  /** A row id (hiatus, override) nothing has. */
  missingId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** Stores a legacy join-date correction (the app never writes them). */
  seedJoinDate: (memberId: string, firstJoinedAt: string) => Promise<void>;
  /** Removes everything stored for the three members. */
  clear: () => Promise<void>;
};

/** Behavior every `MemberStatusRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMemberStatusContract(name: string, setup: () => MemberStatusContractContext) {
  describe(`${name} (MemberStatusRepository contract)`, () => {
    let ctx: MemberStatusContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const mine = (id: string) => ctx.members.some((m) => m.id === id);

    describe("hiatus", () => {
      it("creates a hiatus with its defaults, finds it by id, changes it and deletes it", async () => {
        const created = await ctx.repo().createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-01-10" });
        expect(created).toMatchObject({ member_id: ctx.members[ada].id, start_date: "2026-01-10", end_date: null, reason: null, notes: null });
        expect(await ctx.repo().hiatusById(created.id)).toEqual(created);
        expect(await ctx.repo().hiatusById(ctx.missingId)).toBeNull();

        const changed = await ctx.repo().updateHiatus(created.id, { end_date: "2026-02-01", reason: "travel", notes: "back soon" });
        expect(changed).toMatchObject({ id: created.id, start_date: "2026-01-10", end_date: "2026-02-01", reason: "travel", notes: "back soon" });
        expect(await ctx.repo().hiatusById(created.id)).toMatchObject({ end_date: "2026-02-01", reason: "travel" });
        await expect(ctx.repo().updateHiatus(ctx.missingId, { reason: "x" })).rejects.toThrow();

        await ctx.repo().deleteHiatus(created.id);
        expect(await ctx.repo().hiatusById(created.id)).toBeNull();
        await ctx.repo().deleteHiatus(created.id); // already gone
      });

      it("refuses a hiatus for a member that does not exist", async () => {
        await expect(ctx.repo().createHiatus({ member_id: ctx.missingMemberId, start_date: "2026-01-10" })).rejects.toThrow();
      });

      it("lists a member's hiatuses latest start first, without other members'", async () => {
        const repo = ctx.repo();
        const early = await repo.createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-01-01", end_date: "2026-01-31", reason: "a", notes: "n" });
        const late = await repo.createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-05-01" });
        await repo.createHiatus({ member_id: ctx.members[bo].id, start_date: "2026-03-01" });

        const list = await repo.hiatusesOf(ctx.members[ada].id);
        expect(list.map((h) => h.id)).toEqual([late.id, early.id]);
        expect(list[1]).toEqual({ id: early.id, start_date: "2026-01-01", end_date: "2026-01-31", reason: "a", notes: "n" });
        expect(await repo.hiatusesOf(ctx.members[cy].id)).toEqual([]);
      });

      it("scans every member's hiatuses by id", async () => {
        const repo = ctx.repo();
        const a = await repo.createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-01-01" });
        const b = await repo.createHiatus({ member_id: ctx.members[bo].id, start_date: "2026-02-01", end_date: "2026-03-01" });

        const all = await repo.allHiatuses();
        const ours = all.filter((h) => mine(h.member_id));
        expect(ours).toHaveLength(2);
        expect(ours.find((h) => h.id === a.id)).toEqual({ id: a.id, member_id: ctx.members[ada].id, start_date: "2026-01-01", end_date: null });
        expect(ours.find((h) => h.id === b.id)).toMatchObject({ end_date: "2026-03-01" });
        const ids = all.map((h) => h.id);
        expect(ids).toEqual([...ids].sort());
      });

      it("knows who is on hiatus on a day: begun, and open or ending on or after it", async () => {
        const repo = ctx.repo();
        await repo.createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-06-01" }); // open
        await repo.createHiatus({ member_id: ctx.members[bo].id, start_date: "2026-05-01", end_date: "2026-06-10" }); // ends that day
        await repo.createHiatus({ member_id: ctx.members[cy].id, start_date: "2026-06-11" }); // not begun

        const on = async (day: string) => [...(await repo.memberIdsOnHiatus(day))].filter(mine).sort();
        expect(await on("2026-06-10")).toEqual([ctx.members[ada].id, ctx.members[bo].id].sort());
        expect(await on("2026-06-11")).toEqual([ctx.members[ada].id, ctx.members[cy].id].sort());
        expect(await on("2026-04-30")).toEqual([]);
      });
    });

    describe("status overrides", () => {
      it("creates an override with its member, changes it and deletes it", async () => {
        const created = await ctx.repo().createStatusOverride({
          member_id: ctx.members[ada].id,
          override_type: "gift",
          reason: "Thank you",
          starts_at: "2026-01-01T00:00:00Z",
          created_by: ctx.userId,
        });
        expect(created).toMatchObject({
          member_id: ctx.members[ada].id,
          override_type: "gift",
          reason: "Thank you",
          notes: null,
          expires_at: null,
          created_by: ctx.userId,
          member: { id: ctx.members[ada].id, name: ctx.members[ada].name, display_name: "Ada E.", email: ctx.members[ada].email },
        });

        const changed = await ctx.repo().updateStatusOverride(created.id, { override_type: "special", notes: "Lifetime", expires_at: "2027-01-01T00:00:00Z" });
        expect(changed).toMatchObject({ id: created.id, override_type: "special", reason: "Thank you", notes: "Lifetime", member: { id: ctx.members[ada].id } });
        expect(new Date(changed.expires_at!).toISOString()).toBe("2027-01-01T00:00:00.000Z");
        await expect(ctx.repo().updateStatusOverride(ctx.missingId, { notes: "x" })).rejects.toThrow();

        await ctx.repo().deleteStatusOverride(created.id);
        expect((await ctx.repo().allStatusOverrides()).some((o) => o.id === created.id)).toBe(false);
        await ctx.repo().deleteStatusOverride(created.id); // already gone
      });

      it("keeps a value only given as undefined at its default", async () => {
        const created = await ctx.repo().createStatusOverride({ member_id: ctx.members[bo].id, override_type: "gift", reason: "r", notes: undefined, starts_at: undefined, expires_at: undefined });
        expect(created.notes).toBeNull();
        expect(created.expires_at).toBeNull();
        expect(typeof created.starts_at).toBe("string");
        const same = await ctx.repo().updateStatusOverride(created.id, { notes: undefined, reason: "changed" });
        expect(same).toMatchObject({ reason: "changed", notes: null });
      });

      it("lists a member's overrides latest start first", async () => {
        const repo = ctx.repo();
        const early = await repo.createStatusOverride({ member_id: ctx.members[ada].id, override_type: "gift", reason: "early", starts_at: "2026-01-01T00:00:00Z" });
        const late = await repo.createStatusOverride({ member_id: ctx.members[ada].id, override_type: "special", reason: "late", starts_at: "2026-06-01T00:00:00Z" });
        await repo.createStatusOverride({ member_id: ctx.members[bo].id, override_type: "gift", reason: "other", starts_at: "2026-03-01T00:00:00Z" });

        const list = await repo.statusOverridesOf(ctx.members[ada].id);
        expect(list.map((o) => o.id)).toEqual([late.id, early.id]);
        expect(Object.keys(list[0]).sort()).toEqual(["expires_at", "id", "override_type", "reason", "starts_at"]);
        expect(await repo.statusOverridesOf(ctx.members[cy].id)).toEqual([]);
      });

      it("scans every override, oldest first as stored and newest first with members", async () => {
        const repo = ctx.repo();
        const older = await repo.createStatusOverride({ member_id: ctx.members[ada].id, override_type: "gift", reason: "older", created_at: "2026-01-01T00:00:00Z" });
        const newer = await repo.createStatusOverride({ member_id: ctx.members[bo].id, override_type: "gift", reason: "newer", created_at: "2026-02-01T00:00:00Z" });

        const stored = (await repo.allStatusOverrides()).filter((o) => o.id === older.id || o.id === newer.id);
        expect(stored.map((o) => o.id)).toEqual([older.id, newer.id]);
        expect(stored[0]).not.toHaveProperty("member");

        const withMembers = (await repo.statusOverridesWithMember()).filter((o) => o.id === older.id || o.id === newer.id);
        expect(withMembers.map((o) => o.id)).toEqual([newer.id, older.id]);
        expect(withMembers[0].member).toEqual({ id: ctx.members[bo].id, name: ctx.members[bo].name, display_name: null, email: ctx.members[bo].email });
      });
    });

    it("moves every hiatus and override of one member to another", async () => {
      const repo = ctx.repo();
      const hiatus = await repo.createHiatus({ member_id: ctx.members[ada].id, start_date: "2026-01-01" });
      const override = await repo.createStatusOverride({ member_id: ctx.members[ada].id, override_type: "gift", reason: "r" });
      const staying = await repo.createHiatus({ member_id: ctx.members[cy].id, start_date: "2026-02-01" });

      await repo.reassignMember(ctx.members[ada].id, ctx.members[bo].id);

      expect((await repo.hiatusById(hiatus.id))?.member_id).toBe(ctx.members[bo].id);
      expect((await repo.statusOverridesOf(ctx.members[bo].id)).map((o) => o.id)).toEqual([override.id]);
      expect(await repo.hiatusesOf(ctx.members[ada].id)).toEqual([]);
      expect(await repo.statusOverridesOf(ctx.members[ada].id)).toEqual([]);
      expect((await repo.hiatusById(staying.id))?.member_id).toBe(ctx.members[cy].id);
      await repo.reassignMember(ctx.members[ada].id, ctx.members[bo].id); // nothing left to move
    });

    it("lists legacy join-date corrections", async () => {
      expect((await ctx.repo().joinDateOverrides()).filter((o) => mine(o.member_id))).toEqual([]);
      await ctx.seedJoinDate(ctx.members[bo].id, "2019-03-04T00:00:00Z");
      await ctx.seedJoinDate(ctx.members[ada].id, "2018-01-02T00:00:00Z");

      const ours = (await ctx.repo().joinDateOverrides()).filter((o) => mine(o.member_id));
      expect(ours.map((o) => o.member_id)).toEqual([ctx.members[ada].id, ctx.members[bo].id].sort());
      expect(new Date(ours.find((o) => o.member_id === ctx.members[bo].id)!.first_joined_at).toISOString()).toBe("2019-03-04T00:00:00.000Z");
      expect(Object.keys(ours[0]).sort()).toEqual(["first_joined_at", "member_id"]);
    });

    describe("profile overrides", () => {
      it("is null until the member saves something", async () => {
        expect(await ctx.repo().profileOverrideOf(ctx.members[ada].id)).toBeNull();
        expect((await ctx.repo().profileOverrides()).filter((p) => mine(p.member_id))).toEqual([]);
      });

      it("saves some fields, keeps the others on the next save and keeps one member apart from another", async () => {
        const repo = ctx.repo();
        await repo.saveProfileOverride(ctx.members[ada].id, { bio: "Hello there", facebook_url: "https://facebook.example/ada" }, ctx.userId);
        expect(await repo.profileOverrideOf(ctx.members[ada].id)).toEqual({ bio: "Hello there", instagram_url: null, facebook_url: "https://facebook.example/ada", twitter_url: null });

        await repo.saveProfileOverride(ctx.members[ada].id, { instagram_url: "https://instagram.example/ada", bio: null }, ctx.userId);
        expect(await repo.profileOverrideOf(ctx.members[ada].id)).toEqual({
          bio: null,
          instagram_url: "https://instagram.example/ada",
          facebook_url: "https://facebook.example/ada",
          twitter_url: null,
        });

        await repo.saveProfileOverride(ctx.members[bo].id, { twitter_url: "https://x.example/bo" }, ctx.userId);
        expect(await repo.profileOverrideOf(ctx.members[bo].id)).toEqual({ bio: null, instagram_url: null, facebook_url: null, twitter_url: "https://x.example/bo" });
      });

      it("leaves a field out of the save when it is undefined", async () => {
        const repo = ctx.repo();
        await repo.saveProfileOverride(ctx.members[ada].id, { bio: "Kept" }, ctx.userId);
        await repo.saveProfileOverride(ctx.members[ada].id, { bio: undefined, twitter_url: "https://x.example/ada" }, ctx.userId);
        expect(await repo.profileOverrideOf(ctx.members[ada].id)).toMatchObject({ bio: "Kept", twitter_url: "https://x.example/ada" });
      });

      it("scans every member's overrides by member", async () => {
        const repo = ctx.repo();
        await repo.saveProfileOverride(ctx.members[bo].id, { bio: "Bo bio" }, ctx.userId);
        await repo.saveProfileOverride(ctx.members[ada].id, { bio: "Ada bio" }, ctx.userId);

        const ours = (await repo.profileOverrides()).filter((p) => mine(p.member_id));
        expect(ours).toEqual(
          [
            { member_id: ctx.members[ada].id, bio: "Ada bio", instagram_url: null, facebook_url: null, twitter_url: null },
            { member_id: ctx.members[bo].id, bio: "Bo bio", instagram_url: null, facebook_url: null, twitter_url: null },
          ].sort((a, b) => (a.member_id < b.member_id ? -1 : 1)),
        );
      });

      it("refuses an override for a member that does not exist", async () => {
        await expect(ctx.repo().saveProfileOverride(ctx.missingMemberId, { bio: "x" }, ctx.userId)).rejects.toThrow();
      });
    });
  });
}
