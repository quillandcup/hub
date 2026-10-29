import { describe, it, expect, beforeEach } from "vitest";
import type { ChatRepository } from "@/lib/data/chat";

export type SeedChannel = { key: string; slackChannelId?: string; bridgeMode?: "bridged" | "app_only"; bridgeDisabled?: boolean; bridgeStatus?: "ok" | "disconnected" };

export type ChatContractContext = {
  repo: () => ChatRepository;
  /** A string no other run has used (Slack channel ids are unique). */
  unique: (label: string) => string;
  /** Replaces the channels this context made with these; returns each one's Hub id by key. */
  seedChannels: (channels: SeedChannel[]) => Promise<Record<string, string>>;
};

/**
 * Behavior every `ChatRepository` must have; run against the in-memory twin (unit) and Supabase (db).
 * Each slice of the chat repository adds a nested `describe` at the end, and (if it needs rows the
 * context can't make yet) a seeding function on the context.
 */
export function defineChatContract(name: string, setup: () => ChatContractContext) {
  describe(`${name} (ChatRepository contract)`, () => {
    let ctx: ChatContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const NONE = "00000000-0000-4000-8000-000000000000";

    describe("channels", () => {
      it("reads a channel's Slack bridge settings, defaults included, and nothing for a missing channel", async () => {
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannels([
          { key: "plain", slackChannelId: slack },
          { key: "off", slackChannelId: ctx.unique("C"), bridgeMode: "app_only", bridgeDisabled: true, bridgeStatus: "disconnected" },
        ]);

        expect(await ctx.repo().bridgeState(ids.plain)).toEqual({ bridge_mode: "bridged", bridge_disabled: false, bridge_status: "ok" });
        expect(await ctx.repo().bridgeState(ids.off)).toEqual({ bridge_mode: "app_only", bridge_disabled: true, bridge_status: "disconnected" });
        expect(await ctx.repo().bridgeState(NONE)).toBeNull();
      });

      it("finds the channel that mirrors a Slack channel", async () => {
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannels([{ key: "a", slackChannelId: slack }, { key: "b", slackChannelId: ctx.unique("C") }]);

        expect(await ctx.repo().idBySlackChannel(slack)).toBe(ids.a);
        expect(await ctx.repo().idBySlackChannel(ctx.unique("unknown"))).toBeNull();
      });
    });
  });
}
