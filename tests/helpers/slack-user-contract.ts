import { describe, it, expect, beforeEach } from "vitest";
import { SLACKBOT_USER_ID } from "@/lib/slack-matching";
import type { SlackUserRepository, SlackUserSeed } from "@/lib/data/slack-users";

export type SlackUserContractContext = {
  repo: () => SlackUserRepository;
  /** A string no other run has used (Slack ids are unique across the table). */
  unique: (label: string) => string;
  /** Replaces the users this context made with these. A user with Slackbot's id is created only if it isn't already there. */
  seed: (users: SlackUserSeed[]) => Promise<void>;
};

/** Behavior every `SlackUserRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineSlackUserContract(name: string, setup: () => SlackUserContractContext) {
  describe(`${name} (SlackUserRepository contract)`, () => {
    let ctx: SlackUserContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const user = (label: string, extra: Partial<SlackUserSeed> = {}): SlackUserSeed => ({
      user_id: ctx.unique(label),
      email: `${ctx.unique(label).toLowerCase()}@example.test`,
      real_name: `Real ${label}`,
      display_name: `Display ${label}`,
      name: `name-${label}`,
      image_url: `https://img.example.test/${label}.png`,
      is_bot: false,
      is_deleted: false,
      ...extra,
    });
    const ids = (rows: { user_id: string }[], mine: SlackUserSeed[]) => rows.filter((r) => mine.some((m) => m.user_id === r.user_id)).map((r) => r.user_id);

    it("reads one user, or several (those that exist), with their profile", async () => {
      const a = user("a");
      const b = user("b", { image_url: null });
      await ctx.seed([a, b]);

      expect(await ctx.repo().byId(a.user_id)).toEqual({
        user_id: a.user_id,
        email: a.email,
        real_name: a.real_name,
        display_name: a.display_name,
        name: a.name,
        image_url: a.image_url,
        is_bot: false,
        is_deleted: false,
      });
      expect(await ctx.repo().byId(ctx.unique("nobody"))).toBeNull();
      expect((await ctx.repo().byIds([a.user_id, b.user_id, a.user_id, ctx.unique("missing")])).map((r) => r.user_id).sort()).toEqual([a.user_id, b.user_id].sort());
      expect(await ctx.repo().byIds([])).toEqual([]);
    });

    it("finds users by email address, optionally leaving out bots", async () => {
      const human = user("human");
      const bot = user("bot", { is_bot: true });
      const unknown = user("unflagged", { is_bot: null });
      await ctx.seed([human, bot, unknown]);
      const emails = [human.email!, bot.email!, unknown.email!, "nobody@example.test"];

      expect((await ctx.repo().byEmails(emails)).map((r) => r.user_id).sort()).toEqual([human.user_id, bot.user_id, unknown.user_id].sort());
      // `is_bot = false` doesn't match an unflagged (null) user, as in SQL.
      expect((await ctx.repo().byEmails(emails, { excludeBots: true })).map((r) => r.user_id)).toEqual([human.user_id]);
      expect(await ctx.repo().byEmails([])).toEqual([]);
    });

    it("lists everyone by id, leaving out Slackbot and bots when asked", async () => {
      const people = [user("p1"), user("p2", { is_bot: true }), user("p3", { is_bot: null }), user("p4", { is_deleted: true })];
      const slackbot: SlackUserSeed = { user_id: SLACKBOT_USER_ID, real_name: "Slackbot", is_bot: false };
      await ctx.seed([...people, slackbot]);
      const all = [...people, slackbot];

      expect(ids(await ctx.repo().list(), all)).toEqual(all.map((u) => u.user_id).sort());
      expect(ids(await ctx.repo().list({ excludeSlackbot: true }), all)).toEqual(people.map((u) => u.user_id).sort());
      // Not bots, and not Slackbot: p1 and the deactivated p4 (deactivation is the caller's concern).
      expect(ids(await ctx.repo().list({ excludeSlackbot: true, excludeBots: true }), all)).toEqual([people[0].user_id, people[3].user_id].sort());
      expect(ids(await ctx.repo().list({ excludeBots: true }), all)).toEqual([people[0].user_id, people[3].user_id, SLACKBOT_USER_ID].sort());
    });

    it("lists past a thousand users", async () => {
      const crowd = Array.from({ length: 1050 }, (_, i) => user(`crowd-${i}`));
      await ctx.seed(crowd);

      expect(ids(await ctx.repo().list(), crowd)).toHaveLength(1050);
    });

    it("adds users and replaces the ones with the same Slack id", async () => {
      const a = user("replace");
      await ctx.seed([a]);

      await ctx.repo().upsert([
        { user_id: a.user_id, real_name: "Renamed", raw_payload: {} },
        { user_id: ctx.unique("fresh"), real_name: "Fresh", email: "fresh@example.test", raw_payload: {} },
      ]);
      await ctx.repo().upsert([]);

      expect((await ctx.repo().byId(a.user_id))?.real_name).toBe("Renamed");
      expect((await ctx.repo().byEmails(["fresh@example.test"])).map((r) => r.real_name)).toEqual(["Fresh"]);
    });
  });
}
