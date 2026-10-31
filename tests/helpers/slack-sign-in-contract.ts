import { describe, it, expect, beforeEach } from "vitest";
import type { SlackSignInRepository } from "@/lib/data/slack-sign-in";

export type SlackSignInContractContext = {
  repo: () => SlackSignInRepository;
  /** A Slack user id, token hash or code hash no other test or run uses. */
  unique: (label: string) => string;
  /** A signed-in Hub user (a Supabase Auth user) to bind a Slack user to. */
  newUserId: () => Promise<string>;
};

const NOW = new Date("2097-03-01T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

/** Behavior every `SlackSignInRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineSlackSignInContract(name: string, setup: () => SlackSignInContractContext) {
  describe(`${name} (SlackSignInRepository contract)`, () => {
    let ctx: SlackSignInContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const issue = async (slackUserId: string, expiresAt = minutes(10)) => {
      const credential = { tokenHash: ctx.unique("token"), codeHash: ctx.unique("code") };
      await ctx.repo().storeToken({ ...credential, slackUserId, expiresAt });
      return credential;
    };

    describe("bindings", () => {
      it("binds a Slack user to a Hub account and finds the binding from either side", async () => {
        const slack = ctx.unique("U");
        const userId = await ctx.newUserId();

        await ctx.repo().bind(slack, userId, "email_match");

        const expected = { slackUserId: slack, userId, linkedVia: "email_match" };
        expect(await ctx.repo().identityBySlackUser(slack)).toEqual(expected);
        expect(await ctx.repo().identityByUser(userId)).toEqual(expected);
        expect(await ctx.repo().identityBySlackUser(ctx.unique("U"))).toBeNull();
        expect(await ctx.repo().identityByUser(await ctx.newUserId())).toBeNull();
      });

      it("never replaces a binding on first sight: either side already bound is refused", async () => {
        const slack = ctx.unique("U");
        const userId = await ctx.newUserId();
        await ctx.repo().bind(slack, userId, "email_match");

        await expect(ctx.repo().bind(slack, await ctx.newUserId(), "email_alias")).rejects.toThrow();
        await expect(ctx.repo().bind(ctx.unique("U"), userId, "email_alias")).rejects.toThrow();

        expect(await ctx.repo().identityBySlackUser(slack)).toMatchObject({ userId, linkedVia: "email_match" });
      });

      it("connects over an inferred binding of the same Slack user, but not onto an account bound to another Slack user", async () => {
        const slack = ctx.unique("U");
        const inferred = await ctx.newUserId();
        const connecting = await ctx.newUserId();
        await ctx.repo().bind(slack, inferred, "email_match");
        const taken = ctx.unique("U");
        await ctx.repo().bind(taken, connecting, "email_match");

        await expect(ctx.repo().connect(slack, connecting)).rejects.toThrow(); // connecting is bound to `taken`
        await ctx.repo().unbind({ userId: connecting });
        await ctx.repo().connect(slack, connecting);

        expect(await ctx.repo().identityBySlackUser(slack)).toEqual({ slackUserId: slack, userId: connecting, linkedVia: "slack_connect" });
        expect(await ctx.repo().identityByUser(inferred)).toBeNull();
      });

      it("connects a new binding when there is none", async () => {
        const slack = ctx.unique("U");
        const userId = await ctx.newUserId();

        await ctx.repo().connect(slack, userId);

        expect(await ctx.repo().identityByUser(userId)).toEqual({ slackUserId: slack, userId, linkedVia: "slack_connect" });
      });

      it("removes a binding by Slack user or by Hub account, and nothing else", async () => {
        const [slackA, slackB, slackC] = [ctx.unique("U"), ctx.unique("U"), ctx.unique("U")];
        const [userA, userB, userC] = [await ctx.newUserId(), await ctx.newUserId(), await ctx.newUserId()];
        await ctx.repo().bind(slackA, userA, "email_match");
        await ctx.repo().bind(slackB, userB, "email_match");
        await ctx.repo().bind(slackC, userC, "email_match");

        await ctx.repo().unbind({ slackUserId: slackA });
        await ctx.repo().unbind({ userId: userB });
        await ctx.repo().unbind({ userId: userB }); // already gone: nothing happens

        expect(await ctx.repo().identityBySlackUser(slackA)).toBeNull();
        expect(await ctx.repo().identityBySlackUser(slackB)).toBeNull();
        expect(await ctx.repo().identityBySlackUser(slackC)).not.toBeNull();
      });
    });

    describe("sign-in credentials", () => {
      it("spends a button token once, and says who it was issued to", async () => {
        const slack = ctx.unique("U");
        const { tokenHash } = await issue(slack);

        expect(await ctx.repo().consumeToken({ tokenHash }, NOW)).toBe(slack);
        expect(await ctx.repo().consumeToken({ tokenHash }, NOW)).toBeNull();
        expect(await ctx.repo().slackUserForToken(tokenHash)).toBe(slack); // whatever its state
      });

      it("spends the typed code once, and spending one spends the other", async () => {
        const slack = ctx.unique("U");
        const { tokenHash, codeHash } = await issue(slack);

        expect(await ctx.repo().consumeToken({ codeHash }, NOW)).toBe(slack);
        expect(await ctx.repo().consumeToken({ codeHash }, NOW)).toBeNull();
        expect(await ctx.repo().consumeToken({ tokenHash }, NOW)).toBeNull();
      });

      it("refuses an unknown or expired credential, and leaves the expired one unspent", async () => {
        const slack = ctx.unique("U");
        const { tokenHash } = await issue(slack, minutes(10));

        expect(await ctx.repo().consumeToken({ tokenHash: ctx.unique("token") }, NOW)).toBeNull();
        expect(await ctx.repo().consumeToken({ codeHash: ctx.unique("code") }, NOW)).toBeNull();
        expect(await ctx.repo().consumeToken({ tokenHash }, minutes(10))).toBeNull(); // expires_at is not after now
        expect(await ctx.repo().consumeToken({ tokenHash }, minutes(11))).toBeNull();
        expect(await ctx.repo().consumeToken({ tokenHash }, minutes(9))).toBe(slack); // it was never spent
      });

      it("lets only one of simultaneous attempts spend a credential", async () => {
        const slack = ctx.unique("U");
        const { tokenHash } = await issue(slack);

        const results = await Promise.all(Array.from({ length: 6 }, () => ctx.repo().consumeToken({ tokenHash }, NOW)));

        expect(results.filter((r) => r === slack)).toHaveLength(1);
        expect(results.filter((r) => r === null)).toHaveLength(5);
      });

      it("knows nobody for a token that was never issued", async () => {
        expect(await ctx.repo().slackUserForToken(ctx.unique("token"))).toBeNull();
      });

      it("refuses to store a token hash twice", async () => {
        const slack = ctx.unique("U");
        const { tokenHash } = await issue(slack);

        await expect(ctx.repo().storeToken({ tokenHash, codeHash: ctx.unique("code"), slackUserId: slack, expiresAt: minutes(10) })).rejects.toThrow();
      });

      it("deletes only this user's credentials that expired before the cutoff", async () => {
        const slack = ctx.unique("U");
        const someoneElse = ctx.unique("U");
        const old = await issue(slack, minutes(-60 * 30)); // expired 30 hours ago
        const recent = await issue(slack, minutes(-60 * 2)); // expired 2 hours ago
        const live = await issue(slack, minutes(10));
        const others = await issue(someoneElse, minutes(-60 * 30));

        await ctx.repo().deleteExpiredTokens(slack, minutes(-60 * 24));

        expect(await ctx.repo().slackUserForToken(old.tokenHash)).toBeNull();
        expect(await ctx.repo().slackUserForToken(recent.tokenHash)).toBe(slack);
        expect(await ctx.repo().slackUserForToken(live.tokenHash)).toBe(slack);
        expect(await ctx.repo().slackUserForToken(others.tokenHash)).toBe(someoneElse);
      });
    });
  });
}
