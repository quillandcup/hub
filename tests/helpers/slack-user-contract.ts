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
        image_path: null,
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

    it("lists the photos still to copy (deactivated users too), records a copy until the photo changes, and lists copies to remove", async () => {
      const [fresh, copied, noPhoto, deactivated, gone] = [user("fresh"), user("copied"), user("nophoto", { image_url: null }), user("deactivated", { is_deleted: true }), user("gone")];
      await ctx.seed([fresh, copied, noPhoto, deactivated, gone]);
      const mine = async () => (await ctx.repo().photosToCopy()).filter((p) => [fresh, copied, noPhoto, deactivated, gone].some((u) => u.user_id === p.user_id));

      expect((await mine()).map((p) => p.user_id).sort()).toEqual([fresh.user_id, copied.user_id, deactivated.user_id, gone.user_id].sort());

      await ctx.repo().markPhotoCopied(copied.user_id, { from: copied.image_url!, path: `${copied.user_id}/abc.png` });
      expect((await mine()).map((p) => p.user_id)).not.toContain(copied.user_id);
      expect((await ctx.repo().byId(copied.user_id))?.image_path).toBe(`${copied.user_id}/abc.png`);

      // A copy of a photo the user no longer has is not recorded.
      await ctx.repo().markPhotoCopied(fresh.user_id, { from: "https://img.example.test/old.png", path: `${fresh.user_id}/old.png` });
      expect((await ctx.repo().byId(fresh.user_id))?.image_path).toBeNull();

      // A changed photo is copied again, and says which copy it replaces.
      await ctx.repo().upsert([{ user_id: copied.user_id, image_url: "https://img.example.test/new.png", raw_payload: {} }]);
      expect((await mine()).find((p) => p.user_id === copied.user_id)).toEqual({ user_id: copied.user_id, image_url: "https://img.example.test/new.png", image_path: `${copied.user_id}/abc.png` });

      // A copy stays while the user has a photo, deactivated or not; it goes when Slack drops the photo.
      await ctx.repo().markPhotoCopied(gone.user_id, { from: gone.image_url!, path: `${gone.user_id}/g.png` });
      await ctx.repo().upsert([{ user_id: gone.user_id, is_deleted: true, raw_payload: {} }, { user_id: copied.user_id, image_url: null, raw_payload: {} }]);
      expect((await ctx.repo().photoCopiesToRemove()).map((p) => p.user_id)).not.toContain(gone.user_id);
      await ctx.repo().upsert([{ user_id: gone.user_id, image_url: null, raw_payload: {} }]);
      const removable = (await ctx.repo().photoCopiesToRemove()).filter((p) => [copied.user_id, gone.user_id, fresh.user_id].includes(p.user_id));
      expect(removable.map((p) => p.user_id).sort()).toEqual([copied.user_id, gone.user_id].sort());

      await ctx.repo().clearPhotoCopy(gone.user_id, `${gone.user_id}/other.png`);
      expect((await ctx.repo().byId(gone.user_id))?.image_path).toBe(`${gone.user_id}/g.png`);
      await ctx.repo().clearPhotoCopy(gone.user_id, `${gone.user_id}/g.png`);
      expect((await ctx.repo().byId(gone.user_id))?.image_path).toBeNull();
    });
  });
}
