import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthUserRepository } from "@/lib/data/auth-users";

export type AuthUserContractContext = {
  repo: () => AuthUserRepository;
  /** An email address no other test uses. */
  email: (label: string) => string;
};

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const HOUR_MS = 3_600_000;

/** Behavior every `AuthUserRepository` must have; run against the in-memory twin (unit) and Supabase Auth (db). */
export function defineAuthUserContract(name: string, setup: () => AuthUserContractContext) {
  describe(`${name} (AuthUserRepository contract)`, () => {
    let ctx: AuthUserContractContext;
    let made: string[];
    beforeEach(() => {
      ctx = setup();
      made = [];
    });
    afterEach(async () => {
      for (const id of made) await ctx.repo().delete(id).catch(() => {});
    });

    const create = async (label: string, banDuration?: "24h" | "8760h") => {
      const user = await ctx.repo().create({ email: ctx.email(label), banDuration });
      made.push(user.id);
      return user;
    };

    it("creates a confirmed, unbanned account with a lowercase address, and finds it again", async () => {
      const address = ctx.email("Create").toUpperCase().replace("@EXAMPLE.COM", "@example.com");
      const user = await ctx.repo().create({ email: address });
      made.push(user.id);
      expect(user).toMatchObject({ email: address.toLowerCase(), confirmed: true, bannedUntil: null, lastSignInAt: null });
      expect(Number.isNaN(new Date(user.createdAt).getTime())).toBe(false);
      expect(await ctx.repo().byId(user.id)).toMatchObject({ id: user.id, email: address.toLowerCase(), confirmed: true });
      expect((await ctx.repo().all()).map((u) => u.id)).toContain(user.id);
    });

    it("creates an account banned for the duration given", async () => {
      const user = await create("ban", "8760h");
      expect(new Date(user.bannedUntil!).getTime()).toBeGreaterThan(Date.now() + 8000 * HOUR_MS);
    });

    it("refuses an address that is already taken", async () => {
      const user = await create("dupe");
      await expect(ctx.repo().create({ email: user.email! })).rejects.toThrow();
    });

    it("invites a new address as an unconfirmed account, and again while it is pending", async () => {
      const address = ctx.email("invite");
      const invited = await ctx.repo().invite(address);
      made.push(invited.id);
      expect(invited).toMatchObject({ email: address, confirmed: false });
      expect((await ctx.repo().invite(address)).id).toBe(invited.id);
    });

    it("refuses to invite an address whose owner already has an account", async () => {
      const user = await create("accepted");
      await expect(ctx.repo().invite(user.email!)).rejects.toThrow();
    });

    it("answers null for an account that does not exist", async () => {
      expect(await ctx.repo().byId(MISSING_ID)).toBeNull();
    });

    it("bans an account for a while and lifts the ban", async () => {
      const user = await create("setban");
      await ctx.repo().setBan(user.id, "24h");
      const banned = await ctx.repo().byId(user.id);
      expect(new Date(banned!.bannedUntil!).getTime()).toBeGreaterThan(Date.now() + 23 * HOUR_MS);
      await ctx.repo().setBan(user.id, "none");
      expect((await ctx.repo().byId(user.id))!.bannedUntil).toBeNull();
    });

    it("adds app metadata keys and keeps the ones already there", async () => {
      const user = await create("meta");
      await ctx.repo().mergeAppMetadata(user.id, { first: "a" });
      await ctx.repo().mergeAppMetadata(user.id, { second: "b" });
      expect((await ctx.repo().byId(user.id))!.appMetadata).toMatchObject({ first: "a", second: "b" });
    });

    it("changes the sign-in email, refuses one another account has, and fails for an unknown id", async () => {
      const user = await create("set-email");
      const other = await create("set-email-other");
      const next = `${user.email!.split("@")[0]}-new@example.com`;
      await ctx.repo().setEmail(user.id, next.toUpperCase());
      expect((await ctx.repo().byId(user.id))!.email).toBe(next);
      await expect(ctx.repo().setEmail(user.id, other.email!)).rejects.toThrow();
      expect((await ctx.repo().byId(user.id))!.email).toBe(next);
      await expect(ctx.repo().setEmail(MISSING_ID, "nobody-here@example.com")).rejects.toThrow();
    });

    it("generates a sign-in token and code for an account, and for an unknown id fails without creating one", async () => {
      const user = await create("link");
      const link = await ctx.repo().generateMagicLink(user.id);
      expect(link.hashedToken.length).toBeGreaterThan(10);
      expect(link.code).toMatch(/^\d{6,8}$/);
      const before = (await ctx.repo().all()).length;
      await expect(ctx.repo().generateMagicLink(MISSING_ID)).rejects.toThrow();
      expect((await ctx.repo().all()).length).toBe(before);
    });

    it("deletes an account, and refuses one that does not exist", async () => {
      const user = await create("delete");
      await ctx.repo().delete(user.id);
      expect(await ctx.repo().byId(user.id)).toBeNull();
      expect((await ctx.repo().all()).map((u) => u.id)).not.toContain(user.id);
      await expect(ctx.repo().delete(MISSING_ID)).rejects.toThrow();
    });
  });
}
