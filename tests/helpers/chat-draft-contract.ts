import { describe, it, expect, beforeEach } from "vitest";
import { MAX_DRAFT_LENGTH, type ChatDraftRepository, type DraftPlace } from "@/lib/data/chat-drafts";

export type ChatDraftContractContext = {
  repo: () => ChatDraftRepository;
  /** Two members that exist. */
  members: [string, string];
  /** A conversation's box, a reply box in a thread of that conversation, and another conversation's box. */
  places: { conversation: DraftPlace; thread: DraftPlace; other: DraftPlace };
  /** Removes every draft these members made. */
  clear: () => Promise<void>;
};

/** Behavior every `ChatDraftRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineChatDraftContract(name: string, setup: () => ChatDraftContractContext) {
  describe(`${name} (ChatDraftRepository contract)`, () => {
    let ctx: ChatDraftContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("saves a draft and reads it back", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "half a thought");
      expect(await ctx.repo().get(ctx.members[0], ctx.places.conversation)).toMatchObject({ ...ctx.places.conversation, body: "half a thought" });
    });

    it("has no draft until one is saved", async () => {
      expect(await ctx.repo().get(ctx.members[0], ctx.places.conversation)).toBeNull();
    });

    it("keeps one draft per place: saving again replaces the text", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "first");
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "second");
      expect((await ctx.repo().list(ctx.members[0])).map((d) => d.body)).toEqual(["second"]);
    });

    it("keeps a conversation's draft apart from its thread's and from another conversation's", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "in the channel");
      await ctx.repo().save(ctx.members[0], ctx.places.thread, "in the thread");
      await ctx.repo().save(ctx.members[0], ctx.places.other, "elsewhere");
      expect((await ctx.repo().get(ctx.members[0], ctx.places.conversation))?.body).toBe("in the channel");
      expect((await ctx.repo().get(ctx.members[0], ctx.places.thread))?.body).toBe("in the thread");
      expect((await ctx.repo().get(ctx.members[0], ctx.places.other))?.body).toBe("elsewhere");
    });

    it("keeps each member's draft their own", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "mine");
      await ctx.repo().save(ctx.members[1], ctx.places.conversation, "theirs");
      expect((await ctx.repo().get(ctx.members[0], ctx.places.conversation))?.body).toBe("mine");
      expect(await ctx.repo().list(ctx.members[1])).toHaveLength(1);
    });

    it("treats blank text as no draft, clearing an earlier one", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "something");
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "  \n ");
      expect(await ctx.repo().get(ctx.members[0], ctx.places.conversation)).toBeNull();
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "  \n ");
      expect(await ctx.repo().list(ctx.members[0])).toEqual([]);
    });

    it("clears one place and leaves the others", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "a");
      await ctx.repo().save(ctx.members[0], ctx.places.thread, "b");
      await ctx.repo().clear(ctx.members[0], ctx.places.conversation);
      await ctx.repo().clear(ctx.members[0], ctx.places.other);
      expect((await ctx.repo().list(ctx.members[0])).map((d) => d.body)).toEqual(["b"]);
    });

    it("lists the most recently edited draft first", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "older");
      await ctx.repo().save(ctx.members[0], ctx.places.thread, "newer");
      expect((await ctx.repo().list(ctx.members[0])).map((d) => d.body)).toEqual(["newer", "older"]);
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "older, edited");
      expect((await ctx.repo().list(ctx.members[0])).map((d) => d.body)).toEqual(["older, edited", "newer"]);
    });

    it("cuts text past the limit instead of refusing it", async () => {
      await ctx.repo().save(ctx.members[0], ctx.places.conversation, "x".repeat(MAX_DRAFT_LENGTH + 50));
      expect((await ctx.repo().get(ctx.members[0], ctx.places.conversation))?.body).toHaveLength(MAX_DRAFT_LENGTH);
    });
  });
}
