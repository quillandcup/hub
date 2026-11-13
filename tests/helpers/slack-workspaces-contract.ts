import { describe, it, expect, beforeEach } from "vitest";
import type { SlackMessageRepository } from "@/lib/data/slack-messages";
import type { SlackUserRepository } from "@/lib/data/slack-users";
import type { SlackWorkspaceRepository } from "@/lib/data/slack-workspace";
import type { SlackWorkspaceRegistry } from "@/lib/data/slack-workspaces";

export type SlackWorkspacesContractContext = {
  registry: () => SlackWorkspaceRegistry;
  /** The Slack repositories, scoped to one workspace id or (no argument) unscoped. */
  repos: (workspaceId?: string) => { messages: SlackMessageRepository; workspace: SlackWorkspaceRepository; users: SlackUserRepository };
  /** A string no other run has used (Slack ids and team ids are unique across the tables). */
  unique: (label: string) => string;
  /**
   * Whether a Slack id may be held by two workspaces at once. The twin allows it; the database does only once the
   * old single-workspace keys are dropped (docs/SLACK_WORKSPACES.md, "Contract step").
   */
  idsMayCollide: boolean;
};

const DAY = (n: number) => new Date(Date.UTC(2001, 4, n, 12)).toISOString();
const WINDOW: [string, string] = [DAY(1), DAY(28)];

/** Behavior of the Slack workspace registry and of the repositories scoped to a workspace; run against the twin (unit) and Supabase (db). */
export function defineSlackWorkspacesContract(name: string, setup: () => SlackWorkspacesContractContext) {
  describe(`${name} (Slack workspaces contract)`, () => {
    let ctx: SlackWorkspacesContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists the primary workspace first, then the others by name", async () => {
      const registry = ctx.registry();
      await registry.register({ teamId: ctx.unique("T"), name: "Zed Workspace" });
      await registry.register({ teamId: ctx.unique("T"), name: "Alpha Workspace" });
      const listed = await registry.list();
      expect(listed[0].is_primary).toBe(true);
      expect(listed.filter((w) => w.is_primary)).toHaveLength(1);
      const names = listed.filter((w) => !w.is_primary).map((w) => w.name);
      expect(names).toEqual([...names].sort());
      expect((await registry.primary())?.id).toBe(listed[0].id);
    });

    it("registers a workspace once per Slack team and finds it by team id or id; an unknown team is null", async () => {
      const registry = ctx.registry();
      const teamId = ctx.unique("T");
      const first = await registry.register({ teamId, name: "Second", url: "https://second.example.test" });
      const again = await registry.register({ teamId, name: "Second, renamed" });
      expect(again.id).toBe(first.id);
      expect(again).toMatchObject({ name: "Second, renamed", url: "https://second.example.test", is_primary: false, team_id: teamId });
      expect((await registry.byTeamId(teamId))?.id).toBe(first.id);
      expect((await registry.byId(first.id))?.team_id).toBe(teamId);
      expect(await registry.byTeamId(ctx.unique("TUNKNOWN"))).toBeNull();
      expect(await registry.byId("slws_NOTAREALID11")).toBeNull();
    });

    it("keeps each workspace's channels, users, messages and reactions apart when the repositories are scoped", async () => {
      const second = await ctx.registry().register({ teamId: ctx.unique("T"), name: "Shared program" });
      const primary = (await ctx.registry().primary())!;
      const [channelA, channelB, userA, userB] = [ctx.unique("CA"), ctx.unique("CB"), ctx.unique("UA"), ctx.unique("UB")];
      const inPrimary = ctx.repos(primary.id);
      const inSecond = ctx.repos(second.id);

      await inPrimary.workspace.upsertChannels([{ channel_id: channelA, name: ctx.unique("general"), is_private: false, is_archived: false, is_mpim: false, is_im: false, raw_payload: {} }]);
      await inSecond.workspace.upsertChannels([{ channel_id: channelB, name: ctx.unique("general"), is_private: false, is_archived: false, is_mpim: false, is_im: false, raw_payload: {} }]);
      await inPrimary.users.upsert([{ user_id: userA, name: "a", real_name: "Ada Example", is_bot: false, is_deleted: false, raw_payload: {} }]);
      await inSecond.users.upsert([{ user_id: userB, name: "b", real_name: "Bea Example", is_bot: false, is_deleted: false, raw_payload: {} }]);
      await inPrimary.messages.upsertMessages([{ channel_id: channelA, message_ts: "1000000001.000100", user_id: userA, occurred_at: DAY(2), text: "hi", raw_payload: {} }]);
      await inSecond.messages.upsertMessages([{ channel_id: channelB, message_ts: "1000000002.000100", user_id: userB, occurred_at: DAY(3), text: "hi", raw_payload: {} }]);
      await inSecond.messages.upsertReactions([{ channel_id: channelB, message_ts: "1000000002.000100", user_id: userA, reaction: "tada", occurred_at: DAY(4), raw_payload: {} }]);

      const mineOnly = <T extends { channel_id: string }>(rows: T[]) => rows.filter((r) => r.channel_id === channelA || r.channel_id === channelB);

      // Scoped reads see only their workspace, and say which it is.
      expect(mineOnly(await inPrimary.workspace.channels()).map((c) => [c.channel_id, c.workspace_id])).toEqual([[channelA, primary.id]]);
      expect(mineOnly(await inSecond.workspace.channels()).map((c) => [c.channel_id, c.workspace_id])).toEqual([[channelB, second.id]]);
      expect(await inPrimary.users.byId(userB)).toBeNull();
      expect((await inSecond.users.byId(userB))?.real_name).toBe("Bea Example");
      expect(mineOnly(await inPrimary.messages.liveMessagesBetween(...WINDOW)).map((m) => m.workspace_id)).toEqual([primary.id]);
      expect(mineOnly(await inSecond.messages.liveMessagesBetween(...WINDOW)).map((m) => m.workspace_id)).toEqual([second.id]);
      expect(mineOnly(await inPrimary.messages.liveReactionsBetween(...WINDOW))).toEqual([]);
      expect(mineOnly(await inSecond.messages.liveReactionsBetween(...WINDOW))).toHaveLength(1);

      // Unscoped (the combined view) sees both, each row marked with its workspace.
      const combined = ctx.repos();
      expect(mineOnly(await combined.messages.liveMessagesBetween(...WINDOW)).map((m) => [m.channel_id, m.workspace_id]).sort()).toEqual(
        [[channelA, primary.id], [channelB, second.id]].sort()
      );
      expect(mineOnly(await combined.workspace.channels())).toHaveLength(2);
      // A scoped write to a channel of the other workspace's does not touch it.
      await inPrimary.messages.markMessagesDeleted(channelB, ["1000000002.000100"], DAY(10));
      expect(mineOnly(await inSecond.messages.liveMessagesBetween(...WINDOW))).toHaveLength(1);
    });

    it("holds the same channel, user and message ids in two workspaces as separate rows", async (context) => {
      if (!ctx.idsMayCollide) return context.skip();
      const second = await ctx.registry().register({ teamId: ctx.unique("T"), name: "Collides" });
      const primary = (await ctx.registry().primary())!;
      const [channel, user] = [ctx.unique("CSAME"), ctx.unique("USAME")];
      for (const [workspaceId, text, name] of [[primary.id, "first", "general"], [second.id, "second", "random"]] as const) {
        const repos = ctx.repos(workspaceId);
        await repos.workspace.upsertChannels([{ channel_id: channel, name, is_private: false, is_archived: false, is_mpim: false, is_im: false, raw_payload: {} }]);
        await repos.users.upsert([{ user_id: user, name, real_name: text, is_bot: false, is_deleted: false, raw_payload: {} }]);
        await repos.messages.upsertMessages([{ channel_id: channel, message_ts: "1000000009.000100", user_id: user, occurred_at: DAY(5), text, raw_payload: {} }]);
        await repos.messages.upsertReactions([{ channel_id: channel, message_ts: "1000000009.000100", user_id: user, reaction: "tada", occurred_at: DAY(5), raw_payload: {} }]);
        await repos.workspace.restrictChannel(channel, name);
        await repos.workspace.ignoreUser(user, "test");
      }
      // Importing the same thing again changes nothing (idempotent per workspace).
      await ctx.repos(second.id).messages.upsertMessages([{ channel_id: channel, message_ts: "1000000009.000100", user_id: user, occurred_at: DAY(5), text: "second", raw_payload: {} }]);

      for (const [workspaceId, name] of [[primary.id, "general"], [second.id, "random"]] as const) {
        const repos = ctx.repos(workspaceId);
        expect((await repos.workspace.channelById(channel))?.name).toBe(name);
        expect((await repos.users.byId(user))?.real_name).toBe(name === "general" ? "first" : "second");
        expect((await repos.messages.liveMessagesBetween(...WINDOW)).filter((m) => m.channel_id === channel)).toHaveLength(1);
        expect((await repos.messages.liveReactionsBetween(...WINDOW)).filter((r) => r.channel_id === channel)).toHaveLength(1);
        expect((await repos.workspace.restrictedChannels()).has(channel)).toBe(true);
        expect((await repos.workspace.ignoredUserIds()).has(user)).toBe(true);
      }
      // Unrestricting in one workspace leaves the other restricted.
      await ctx.repos(second.id).workspace.unrestrictChannel(channel);
      expect((await ctx.repos(second.id).workspace.restrictedChannels()).has(channel)).toBe(false);
      expect((await ctx.repos(primary.id).workspace.restrictedChannels()).has(channel)).toBe(true);
    });
  });
}
