import { describe, it, expect, beforeEach } from "vitest";
import type { ChatVideoRepository } from "@/lib/data/chat-videos";

export type ChatVideoContractContext = {
  repo: () => ChatVideoRepository;
  /** Three chat messages that exist and share nothing yet. */
  messages: [string, string, string];
  /** Two course lessons that exist. */
  lessons: [string, string];
  /** Removes the shares this context made. */
  clear: () => Promise<void>;
};

/** Behavior every `ChatVideoRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineChatVideoContract(name: string, setup: () => ChatVideoContractContext) {
  describe(`${name} (ChatVideoRepository contract)`, () => {
    let ctx: ChatVideoContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("finds the lesson each message shares, and leaves out a message that shares none", async () => {
      await ctx.repo().attach(ctx.messages[0], ctx.lessons[0]);
      await ctx.repo().attach(ctx.messages[1], ctx.lessons[1]);

      const found = await ctx.repo().lessonIdsOf(ctx.messages);

      expect([...found.entries()].sort()).toEqual([
        [ctx.messages[0], ctx.lessons[0]],
        [ctx.messages[1], ctx.lessons[1]],
      ].sort());
    });

    it("lets two messages share the same lesson", async () => {
      await ctx.repo().attach(ctx.messages[0], ctx.lessons[0]);
      await ctx.repo().attach(ctx.messages[1], ctx.lessons[0]);

      const found = await ctx.repo().lessonIdsOf([ctx.messages[0], ctx.messages[1]]);

      expect(found.get(ctx.messages[0])).toBe(ctx.lessons[0]);
      expect(found.get(ctx.messages[1])).toBe(ctx.lessons[0]);
    });

    it("refuses a second video on one message", async () => {
      await ctx.repo().attach(ctx.messages[0], ctx.lessons[0]);

      await expect(ctx.repo().attach(ctx.messages[0], ctx.lessons[1])).rejects.toThrow();
      expect((await ctx.repo().lessonIdsOf([ctx.messages[0]])).get(ctx.messages[0])).toBe(ctx.lessons[0]);
    });

    it("answers an empty list with an empty map", async () => {
      expect((await ctx.repo().lessonIdsOf([])).size).toBe(0);
    });
  });
}
