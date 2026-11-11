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

import { buildPreview, previewLinksIn, refreshLinkPreviews, MAX_PREVIEW_LINKS } from "@/lib/chat/link-previews";
import { previewToCard, unfurlKey, withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { unfurlImageUrls } from "@/lib/chat/unfurl-images";
import { parseUnfurls, type CardUnfurl } from "@/lib/chat/unfurls";
import { InMemoryChatLinkPreviewRepository, type LinkPreview } from "@/lib/data/chat-link-previews";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { FetchPageResult } from "@/lib/net/safe-fetch";

const ORIGIN = "https://hub.example.test";
const MESSAGE = "msg_AAAAAAAAAAA9";
const FERN = "mbr_AAAAAAAAAAF1";

const page = (head: string, finalUrl = "https://example.test/post"): FetchPageResult => ({
  ok: true,
  kind: "html",
  bytes: Buffer.from(`<html><head>${head}</head><body></body></html>`),
  contentType: "text/html; charset=utf-8",
  finalUrl,
});

describe("previewLinksIn", () => {
  it("finds bare addresses and Slack link tokens, in order, https only", () => {
    expect(previewLinksIn("see https://a.test/one and <https://b.test/two|the label> then http://c.test/plain", ORIGIN)).toEqual(["https://a.test/one", "https://b.test/two"]);
  });

  it("trims the punctuation that follows an address in a sentence, and decodes entities in a token", () => {
    expect(previewLinksIn("Read https://a.test/one, then (https://b.test/two). Also <https://c.test/?x=1&amp;y=2>!")).toEqual(["https://a.test/one", "https://b.test/two", "https://c.test/?x=1&y=2"]);
  });

  it("keeps the first three, once each", () => {
    const links = previewLinksIn("https://a.test/1 https://a.test/1 https://a.test/2 https://a.test/3 https://a.test/4 https://a.test/5");
    expect(links).toEqual(["https://a.test/1", "https://a.test/2", "https://a.test/3"]);
    expect(links).toHaveLength(MAX_PREVIEW_LINKS);
  });

  it("skips links in code, our own pages, mentions and addresses that are not links", () => {
    expect(previewLinksIn("`https://a.test/code` ```\nhttps://b.test/block\n``` <@U1> <#C1|room> https://hub.example.test/members/x javascript:alert(1) mailto:a@b.test", ORIGIN)).toEqual([]);
  });

  it("is empty for plain text", () => {
    expect(previewLinksIn("")).toEqual([]);
    expect(previewLinksIn("just words")).toEqual([]);
  });
});

describe("buildPreview", () => {
  it("builds a link preview from the page's head", async () => {
    const draft = await buildPreview("https://example.test/post", 1, async () => page(`<meta property="og:title" content="Tom &amp; Jerry"><meta property="og:image" content="/cover.png">`));
    expect(draft).toMatchObject({ url: "https://example.test/post", position: 1, status: "ok", kind: "link", title: "Tom & Jerry", imageUrl: "https://example.test/cover.png" });
  });

  it("builds a picture card for a link straight to a picture", async () => {
    const draft = await buildPreview("https://example.test/a.jpg", 0, async () => ({ ok: true, kind: "image", finalUrl: "https://example.test/a.jpg" }));
    expect(draft).toMatchObject({ status: "ok", kind: "image", imageUrl: "https://example.test/a.jpg", title: null });
  });

  it("records a refused address as blocked and any other trouble as failed", async () => {
    expect((await buildPreview("https://x.test/", 0, async () => ({ ok: false, reason: "blocked", detail: "not a public address" }))).status).toBe("blocked");
    expect((await buildPreview("https://x.test/", 0, async () => ({ ok: false, reason: "timeout", detail: "" }))).status).toBe("failed");
    expect((await buildPreview("https://x.test/", 0, async () => ({ ok: false, reason: "bad_status", detail: "" }))).status).toBe("failed");
    expect((await buildPreview("https://x.test/", 0, async () => { throw new Error("boom"); })).status).toBe("failed");
  });

  it("calls a page with nothing to say failed, not a blank card", async () => {
    expect((await buildPreview("https://x.test/", 0, async () => page(`<meta name="robots" content="all">`))).status).toBe("failed");
  });
});

describe("refreshLinkPreviews (the send path and the edit path)", () => {
  const setup = () => {
    const data = new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }] });
    return { data, repo: new InMemoryChatLinkPreviewRepository(data) };
  };
  const fetched: string[] = [];
  const fetcher = async (url: string): Promise<FetchPageResult> => {
    fetched.push(url);
    if (url.includes("down")) return { ok: false, reason: "network", detail: "" };
    return page(`<meta property="og:title" content="Title of ${new URL(url).pathname}">`, url);
  };

  it("fetches the links of a new message once and stores what it found, failures included", async () => {
    const { repo } = setup();
    fetched.length = 0;

    const { looked } = await refreshLinkPreviews(repo, MESSAGE, "https://a.test/one https://b.test/down", { ownOrigin: ORIGIN, fetchTheAddress: fetcher });

    expect(looked.map((d) => d.status)).toEqual(["ok", "failed"]);
    expect(fetched).toEqual(["https://a.test/one", "https://b.test/down"]);
    expect([...(await repo.forMessages([MESSAGE])).get(MESSAGE)!.map((p) => p.title)]).toEqual(["Title of /one"]);
  });

  it("on an edit fetches only the new link, forgets the one taken out and does not ask again for one that failed", async () => {
    const { repo } = setup();
    await refreshLinkPreviews(repo, MESSAGE, "https://a.test/one https://b.test/down", { fetchTheAddress: fetcher });
    fetched.length = 0;

    await refreshLinkPreviews(repo, MESSAGE, "https://b.test/down https://c.test/three", { fetchTheAddress: fetcher });

    expect(fetched).toEqual(["https://c.test/three"]);
    expect([...(await repo.looked(MESSAGE))].sort()).toEqual(["https://b.test/down", "https://c.test/three"]);
    expect((await repo.forMessages([MESSAGE])).get(MESSAGE)!.map((p) => p.url)).toEqual(["https://c.test/three"]);
  });

  it("fetches nothing for an edit that keeps the same links", async () => {
    const { repo } = setup();
    await refreshLinkPreviews(repo, MESSAGE, "hello https://a.test/one", { fetchTheAddress: fetcher });
    fetched.length = 0;

    await refreshLinkPreviews(repo, MESSAGE, "hello again https://a.test/one", { fetchTheAddress: fetcher });

    expect(fetched).toEqual([]);
  });

  it("never throws: a repository that fails is logged", async () => {
    const { repo } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repo.looked = async () => {
      throw new Error("database down");
    };
    await expect(refreshLinkPreviews(repo, MESSAGE, "https://a.test/one", { fetchTheAddress: fetcher })).resolves.toEqual({ looked: [] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not bring back a card its author removed when the link is fetched again", async () => {
    const { data, repo } = setup();
    await refreshLinkPreviews(repo, MESSAGE, "https://a.test/one", { fetchTheAddress: fetcher });
    await repo.hide(MESSAGE, "url:https://a.test/one");
    await repo.forget(MESSAGE, []);
    await refreshLinkPreviews(repo, MESSAGE, "https://a.test/one", { fetchTheAddress: fetcher });

    const row: MessageRow = { id: MESSAGE, author_member_id: FERN, slack_ts: null, origin: "app", created_at: "2026-10-01T00:00:00Z", edited_at: null, deleted_at: null, reply_count: 0, last_reply_at: null, has_files: false, chat_message_contents: { body: "https://a.test/one" } };
    const out = await buildMessageViews(createInMemoryRepos(data), { slackChannelId: null }, [row], FERN);

    expect(out.views[0].unfurls).toEqual([]);
  });
});

describe("loading a Hub message with previews", () => {
  const row = (body: string, attachments?: unknown[]): MessageRow => ({
    id: MESSAGE,
    author_member_id: FERN,
    slack_ts: null,
    origin: "app",
    created_at: "2026-10-01T00:00:00Z",
    edited_at: null,
    deleted_at: null,
    reply_count: 0,
    last_reply_at: null,
    has_files: false,
    chat_message_contents: { body, attachments },
  });

  it("draws a stored preview as a card, its picture through our route, and says what removes it", async () => {
    const data = new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }] });
    const repos = createInMemoryRepos(data);
    await repos.chatLinkPreviews.save(MESSAGE, [{ url: "https://example.test/post", position: 0, finalUrl: "https://example.test/post", kind: "link", status: "ok", title: "Tom & <Jerry>", description: "A *plain* & simple text", siteName: "Example", imageUrl: "https://example.test/cover.png" }]);

    const out = await buildMessageViews(repos, { slackChannelId: null }, [row("https://example.test/post")], FERN);

    const card = out.views[0].unfurls?.[0] as CardUnfurl;
    expect(card).toMatchObject({ kind: "card", title: "Tom & <Jerry>", text: "A *plain* & simple text", hubPreview: true, serviceName: "Example", removeKey: "url:https://example.test/post", titleLink: "https://example.test/post" });
    expect(card.imageUrl).toBe(`/api/chat/unfurl-image?m=${MESSAGE}&i=0`);
  });

  it("leaves a message with failed or no previews as it was", async () => {
    const data = new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }] });
    const repos = createInMemoryRepos(data);
    await repos.chatLinkPreviews.save(MESSAGE, [{ url: "https://example.test/down", position: 0, finalUrl: null, kind: "link", status: "failed", title: null, description: null, siteName: null, imageUrl: null }]);

    const out = await buildMessageViews(repos, { slackChannelId: null }, [row("https://example.test/down")], FERN);

    expect(out.views[0].unfurls).toEqual([]);
  });

  it("lets the author remove one of Slack's unfurls too, by its address, and drops its picture from the list the route serves", async () => {
    const attachments = [
      { title: "Keep", title_link: "https://keep.example.test/", image_url: "https://img.example.test/keep.png" },
      { title: "Drop", title_link: "https://drop.example.test/", image_url: "https://img.example.test/drop.png" },
    ];
    const data = new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }] });
    const repos = createInMemoryRepos(data);
    await repos.chatLinkPreviews.hide(MESSAGE, "url:https://drop.example.test/");

    const out = await buildMessageViews(repos, { slackChannelId: null }, [{ ...row("look", attachments), origin: "slack" }], FERN);

    expect((out.views[0].unfurls as CardUnfurl[]).map((u) => u.title)).toEqual(["Keep"]);
    expect((out.views[0].unfurls as CardUnfurl[])[0].removeKey).toBe("url:https://keep.example.test/");
    const hidden = new Set(["url:https://drop.example.test/"]);
    expect(unfurlImageUrls(withLinkPreviews(parseUnfurls({ attachments }, { bot: false, body: "look" }).unfurls, undefined, hidden), null)).toEqual(["https://img.example.test/keep.png"]);
  });
});

describe("previewToCard and unfurlKey", () => {
  const preview = (over: Partial<LinkPreview> = {}): LinkPreview => ({ messageId: MESSAGE, position: 0, url: "https://example.test/post", finalUrl: "https://www.example.test/final", kind: "link", status: "ok", title: "T", description: null, siteName: null, imageUrl: null, fetchedAt: "2026-10-01T00:00:00Z", ...over });

  it("keys a Hub preview by the address written in the message, not where it ended up", () => {
    const card = previewToCard(preview())!;
    expect(unfurlKey(card, 3)).toBe("url:https://example.test/post");
    expect(card.titleLink).toBe("https://www.example.test/final");
    expect(card.serviceName).toBe("example.test");
  });

  it("draws a picture card for a link to a picture, linked to where it lives", () => {
    const card = previewToCard(preview({ kind: "image", title: null, imageUrl: "https://example.test/a.png" }))!;
    expect(card).toMatchObject({ imageUrl: "https://example.test/a.png", title: null, hubPreview: true, titleLink: "https://www.example.test/final" });
  });

  it("draws nothing for a failed preview, an empty one, a picture card without a picture or an unsafe address", () => {
    expect(previewToCard(preview({ status: "failed" }))).toBeNull();
    expect(previewToCard(preview({ title: null, description: null }))).toBeNull();
    expect(previewToCard(preview({ kind: "image", imageUrl: null }))).toBeNull();
    expect(previewToCard(preview({ url: "javascript:alert(1)", finalUrl: null }))).toBeNull();
    expect(previewToCard(preview({ imageUrl: "http://example.test/x.png" }))?.imageUrl).toBeNull();
  });

  it("uses the host as the title when the page only has a description", () => {
    expect(previewToCard(preview({ title: null, description: "Just words" }))).toMatchObject({ title: "example.test", text: "Just words" });
  });

  it("keys a Slack card without an address by its place, and offers no key for blocks or shares", () => {
    const [card] = parseUnfurls({ attachments: [{ title: "No address" }] }, { bot: false, body: "x" }).unfurls;
    expect(unfurlKey(card, 2)).toBe("idx:2");
    expect(unfurlKey({ kind: "blocks", blocks: [] }, 0)).toBeNull();
    expect(unfurlKey({ kind: "share", attachment: {} }, 0)).toBeNull();
  });
});
