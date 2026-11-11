import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async () => ({}),
  slackUserNames: async () => ({}),
  slackUserPhotos: async () => ({}),
}));

import { isDuplicateOfHubPreview, normalizeLinkForMatch, previewedAddresses } from "@/lib/chat/unfurl-dedupe";
import { withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { unfurlImageUrls } from "@/lib/chat/unfurl-images";
import { parseUnfurls, type CardUnfurl } from "@/lib/chat/unfurls";
import type { LinkPreview } from "@/lib/data/chat-link-previews";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const MESSAGE = "msg_AAAAAAAAAAA9";
const FERN = "mbr_AAAAAAAAAAF1";

const preview = (over: Partial<LinkPreview> = {}): LinkPreview => ({
  messageId: MESSAGE,
  position: 0,
  url: "https://example.test/post",
  finalUrl: "https://example.test/post",
  kind: "link",
  status: "ok",
  title: "Hub title",
  description: "Hub text",
  siteName: null,
  imageUrl: "https://example.test/hub.png",
  fetchedAt: "2026-10-01T00:00:00Z",
  ...over,
});
const slackCards = (attachments: unknown[]) => parseUnfurls({ attachments }, { bot: false, body: "look" }).unfurls;
const titles = (unfurls: unknown[]) => (unfurls as CardUnfurl[]).map((c) => c.title);

describe("normalizeLinkForMatch", () => {
  it("treats http and https, www, case, a fragment, a trailing slash and tracking parameters as the same page", () => {
    const base = normalizeLinkForMatch("https://example.test/post");
    for (const same of ["http://example.test/post", "https://WWW.Example.test/post/", "https://example.test/post#top", "https://example.test/post?utm_source=x&utm_medium=y&fbclid=1"]) {
      expect(normalizeLinkForMatch(same)).toBe(base);
    }
  });

  it("keeps the parameters that choose the page, in any order, and tells different pages apart", () => {
    expect(normalizeLinkForMatch("https://example.test/p?b=2&a=1")).toBe(normalizeLinkForMatch("https://example.test/p?a=1&b=2&utm_campaign=z"));
    expect(normalizeLinkForMatch("https://example.test/p?a=1")).not.toBe(normalizeLinkForMatch("https://example.test/p?a=2"));
    expect(normalizeLinkForMatch("https://example.test/one")).not.toBe(normalizeLinkForMatch("https://example.test/two"));
    expect(normalizeLinkForMatch("https://example.test:8443/one")).not.toBe(normalizeLinkForMatch("https://example.test/one"));
  });

  it("is null for anything that is not a web address", () => {
    for (const bad of [null, undefined, "", "not a url", "mailto:a@b.test", "javascript:alert(1)"]) expect(normalizeLinkForMatch(bad)).toBeNull();
  });
});

describe("previewedAddresses / isDuplicateOfHubPreview", () => {
  it("counts only previews the Hub can draw, by the address written and the one it ended at", () => {
    const set = previewedAddresses([preview({ finalUrl: "https://example.test/final" }), preview({ url: "https://failed.test/", finalUrl: null, status: "failed" })]);
    expect(set.has(normalizeLinkForMatch("https://example.test/post")!)).toBe(true);
    expect(set.has(normalizeLinkForMatch("https://example.test/final")!)).toBe(true);
    expect(set.has(normalizeLinkForMatch("https://failed.test/")!)).toBe(false);
    expect(previewedAddresses(undefined).size).toBe(0);
  });

  it("matches a Slack card on its original, source or title address, and never a Hub card", () => {
    const set = previewedAddresses([preview()]);
    const cards = slackCards([
      { title: "A", original_url: "http://example.test/post/?utm_source=a" },
      { title: "B", from_url: "https://www.example.test/post#x" },
      { title: "C", title_link: "https://example.test/post" },
      { title: "D", title_link: "https://elsewhere.test/post" },
    ]) as CardUnfurl[];
    expect(cards.map((c) => isDuplicateOfHubPreview(c, set))).toEqual([true, true, true, false]);
    expect(isDuplicateOfHubPreview({ ...cards[2], hubPreview: true }, set)).toBe(false);
    expect(isDuplicateOfHubPreview(cards[2], new Set())).toBe(false);
  });
});

describe("withLinkPreviews with both sources", () => {
  it("draws one card (the Hub's) when Slack unfurled a link the Hub also previewed", () => {
    const out = withLinkPreviews(slackCards([{ title: "Slack title", title_link: "https://example.test/post/", original_url: "https://example.test/post?utm_source=x" }]), [preview()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ hubPreview: true, title: "Hub title", removeKey: "url:https://example.test/post" });
  });

  it("falls back to Slack's card for a link the Hub failed on, and keeps cards for other links", () => {
    const cards = slackCards([
      { title: "Slack failed", title_link: "https://down.test/" },
      { title: "Slack ok", title_link: "https://example.test/post" },
      { title: "Slack third", title_link: "https://third.test/" },
    ]);
    const out = withLinkPreviews(cards, [preview(), preview({ url: "https://down.test/", finalUrl: null, status: "failed", position: 1 })]);
    expect(titles(out)).toEqual(["Slack failed", "Slack third", "Hub title"]);
  });

  it("draws Slack's card alone when the Hub has no preview (yet)", () => {
    expect(titles(withLinkPreviews(slackCards([{ title: "Slack only", title_link: "https://example.test/post" }]), undefined))).toEqual(["Slack only"]);
  });

  it("draws nothing for a removed link whichever source it came from, and an idx mark keeps pointing at the same card", () => {
    const attachments = [{ title: "Slack dup", title_link: "https://example.test/post" }, { title: "No address" }, { title: "Slack other", title_link: "https://other.test/" }];
    const out = withLinkPreviews(slackCards(attachments), [preview()], new Set(["url:https://example.test/post"]));
    expect(titles(out)).toEqual(["No address", "Slack other"]);
    expect((out[0] as CardUnfurl).removeKey).toBe("idx:1");
    // The same mark removes the same card with or without the Hub preview (and so with or without Slack's duplicate).
    expect(titles(withLinkPreviews(slackCards(attachments), undefined, new Set(["idx:1"])))).toEqual(["Slack dup", "Slack other"]);
    expect(titles(withLinkPreviews(slackCards(attachments), [preview()], new Set(["idx:1"])))).toEqual(["Slack other", "Hub title"]);
  });

  it("lists pictures only for cards that are drawn, so a position never points at a dropped duplicate", () => {
    const cards = slackCards([
      { title: "Dup", title_link: "https://example.test/post", image_url: "https://img.example.test/slack.png" },
      { title: "Other", title_link: "https://other.test/", image_url: "https://img.example.test/other.png" },
    ]);
    expect(unfurlImageUrls(withLinkPreviews(cards, [preview()]), null)).toEqual(["https://img.example.test/other.png", "https://example.test/hub.png"]);
  });
});

describe("loading a Hub message that Slack also unfurled", () => {
  const row = (attachments: unknown[]): MessageRow => ({
    id: MESSAGE,
    author_member_id: FERN,
    slack_ts: "1700000000.000100",
    origin: "app",
    created_at: "2026-10-01T00:00:00Z",
    edited_at: null,
    deleted_at: null,
    reply_count: 0,
    last_reply_at: null,
    has_files: false,
    chat_message_contents: { body: "https://example.test/post", attachments },
  });
  const ok = { url: "https://example.test/post", position: 0, finalUrl: "https://example.test/post", kind: "link" as const, status: "ok" as const, title: "Hub title", description: null, siteName: null, imageUrl: null };
  const slack = [{ title: "Slack title", title_link: "https://example.test/post", from_url: "https://example.test/post" }];
  const reposWith = async (drafts: (typeof ok)[]) => {
    const r = createInMemoryRepos(new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }] }));
    await r.chatLinkPreviews.save(MESSAGE, drafts);
    return r;
  };

  it("shows one card, the Hub's, when both exist", async () => {
    const out = await buildMessageViews(await reposWith([ok]), { slackChannelId: null }, [row(slack)], FERN);
    expect(titles(out.views[0].unfurls ?? [])).toEqual(["Hub title"]);
  });

  it("shows Slack's card when the Hub has only a failed preview, or none", async () => {
    const failed = await buildMessageViews(await reposWith([{ ...ok, status: "failed" as never, title: null as never }]), { slackChannelId: null }, [row(slack)], FERN);
    expect(titles(failed.views[0].unfurls ?? [])).toEqual(["Slack title"]);
    const none = await buildMessageViews(await reposWith([]), { slackChannelId: null }, [row(slack)], FERN);
    expect(titles(none.views[0].unfurls ?? [])).toEqual(["Slack title"]);
  });

  it("shows nothing when the author removed the link", async () => {
    const r = await reposWith([ok]);
    await r.chatLinkPreviews.hide(MESSAGE, "url:https://example.test/post");
    const out = await buildMessageViews(r, { slackChannelId: null }, [row(slack)], FERN);
    expect(out.views[0].unfurls).toEqual([]);
  });
});
