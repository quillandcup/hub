import { describe, it, expect, beforeEach } from "vitest";
import type { ChatLinkPreviewRepository, LinkPreviewDraft } from "@/lib/data/chat-link-previews";

export type ChatLinkPreviewContractContext = {
  repo: () => ChatLinkPreviewRepository;
  /** Three live chat messages that exist and have no previews yet. */
  messages: [string, string, string];
  /** Removes the previews and removed-card marks this context made. */
  clear: () => Promise<void>;
};

const draft = (url: string, position: number, extra: Partial<LinkPreviewDraft> = {}): LinkPreviewDraft => ({
  url,
  position,
  finalUrl: url,
  kind: "link",
  status: "ok",
  title: `Title of ${url}`,
  description: null,
  siteName: "Example",
  imageUrl: null,
  ...extra,
});

/** Behavior every `ChatLinkPreviewRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineChatLinkPreviewContract(name: string, setup: () => ChatLinkPreviewContractContext) {
  describe(`${name} (ChatLinkPreviewRepository contract)`, () => {
    let ctx: ChatLinkPreviewContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("returns the previews of each message in the order the links were written, and leaves out a message with none", async () => {
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/b", 1), draft("https://example.test/a", 0, { description: "About a", imageUrl: "https://example.test/a.png" })]);

      const found = await ctx.repo().forMessages(ctx.messages);

      expect([...found.keys()]).toEqual([ctx.messages[0]]);
      expect(found.get(ctx.messages[0])?.map((p) => p.url)).toEqual(["https://example.test/a", "https://example.test/b"]);
      expect(found.get(ctx.messages[0])?.[0]).toMatchObject({ title: "Title of https://example.test/a", description: "About a", siteName: "Example", imageUrl: "https://example.test/a.png", kind: "link", status: "ok" });
    });

    it("keeps failed and blocked links out of what is drawn but remembers them, so they are not asked for again", async () => {
      await ctx.repo().save(ctx.messages[0], [
        draft("https://example.test/ok", 0),
        draft("https://example.test/down", 1, { status: "failed", title: null }),
        draft("https://example.test/private", 2, { status: "blocked", title: null }),
      ]);

      expect((await ctx.repo().forMessages([ctx.messages[0]])).get(ctx.messages[0])?.map((p) => p.url)).toEqual(["https://example.test/ok"]);
      expect([...(await ctx.repo().looked(ctx.messages[0]))].sort()).toEqual(["https://example.test/down", "https://example.test/ok", "https://example.test/private"]);
    });

    it("overwrites an address that is saved again rather than adding a second row", async () => {
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0, { title: "Old" })]);
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0, { title: "New" })]);

      const previews = (await ctx.repo().forMessages([ctx.messages[0]])).get(ctx.messages[0]);
      expect(previews).toHaveLength(1);
      expect(previews?.[0].title).toBe("New");
    });

    it("keeps the same address on two messages apart", async () => {
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0)]);
      await ctx.repo().save(ctx.messages[1], [draft("https://example.test/a", 0)]);

      const found = await ctx.repo().forMessages([ctx.messages[0], ctx.messages[1], ctx.messages[2]]);
      expect([...found.keys()].sort()).toEqual([ctx.messages[0], ctx.messages[1]].sort());
    });

    it("forgets the addresses an edit took out and keeps the rest", async () => {
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0), draft("https://example.test/b", 1)]);

      await ctx.repo().forget(ctx.messages[0], ["https://example.test/b"]);

      expect([...(await ctx.repo().looked(ctx.messages[0]))]).toEqual(["https://example.test/b"]);
    });

    it("remembers the cards an author removed, per message, and removing one twice is not an error", async () => {
      await ctx.repo().hide(ctx.messages[0], "url:https://example.test/a");
      await ctx.repo().hide(ctx.messages[0], "url:https://example.test/a");
      await ctx.repo().hide(ctx.messages[0], "idx:1");
      await ctx.repo().hide(ctx.messages[1], "url:https://example.test/a");

      const hidden = await ctx.repo().hiddenKeys(ctx.messages);

      expect([...(hidden.get(ctx.messages[0]) ?? [])].sort()).toEqual(["idx:1", "url:https://example.test/a"]);
      expect([...(hidden.get(ctx.messages[1]) ?? [])]).toEqual(["url:https://example.test/a"]);
      expect(hidden.has(ctx.messages[2])).toBe(false);
      expect((await ctx.repo().hiddenKeys([])).size).toBe(0);
    });

    it("keeps a removal when the preview is fetched again, so an edit does not bring the card back", async () => {
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0)]);
      await ctx.repo().hide(ctx.messages[0], "url:https://example.test/a");
      await ctx.repo().save(ctx.messages[0], [draft("https://example.test/a", 0, { title: "Fetched again" })]);

      expect([...((await ctx.repo().hiddenKeys([ctx.messages[0]])).get(ctx.messages[0]) ?? [])]).toEqual(["url:https://example.test/a"]);
    });

    it("stores nothing and fails nothing for an empty list, and answers an empty list of messages with an empty map", async () => {
      await ctx.repo().save(ctx.messages[0], []);
      expect((await ctx.repo().forMessages([])).size).toBe(0);
      expect((await ctx.repo().looked(ctx.messages[0])).size).toBe(0);
    });
  });
}
