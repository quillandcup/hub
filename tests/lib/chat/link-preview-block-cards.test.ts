import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async () => ({}),
  slackUserPhotos: async () => ({}),
  slackUserNames: async () => ({}),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    throw new Error("no service role in a unit test");
  },
}));

import { cardIsBlocked, withLinkPreviews } from "@/lib/chat/link-preview-cards";
import type { PreviewBlock } from "@/lib/chat/link-preview-blocks";
import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { loadAuthorBlocks } from "@/lib/chat/author-blocks";
import { parseUnfurls, type CardUnfurl } from "@/lib/chat/unfurls";
import type { LinkPreview } from "@/lib/data/chat-link-previews";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const MESSAGE = "msg_AAAAAAAAAAA9";
const FERN = "mbr_AAAAAAAAAAF1";
const MOSS = "mbr_AAAAAAAAAAF2";

const site: PreviewBlock = { scope: "site", host: "blocked.example.test", pathPrefix: null, url: null };
const cards = (attachments: unknown[]) => parseUnfurls({ attachments }, { bot: false, body: "look" }).unfurls;
const titles = (unfurls: unknown[]) => (unfurls as CardUnfurl[]).map((c) => c.title);
const preview = (url: string, title: string): LinkPreview => ({ messageId: MESSAGE, position: 0, url, finalUrl: url, kind: "link", status: "ok", title, description: "text", siteName: null, imageUrl: null, fetchedAt: "2026-10-01T00:00:00Z" });

const SLACK = [
  { title: "Blocked", title_link: "https://blocked.example.test/a", from_url: "https://blocked.example.test/a" },
  { title: "Fine", title_link: "https://fine.example.test/b", from_url: "https://fine.example.test/b" },
];

describe("cardIsBlocked", () => {
  it("matches any address the card carries, and nothing when there are no rules", () => {
    const [blocked, fine] = cards(SLACK) as CardUnfurl[];
    expect(cardIsBlocked(blocked, [site])).toBe(true);
    expect(cardIsBlocked(fine, [site])).toBe(false);
    expect(cardIsBlocked(blocked, [])).toBe(false);
    expect(cardIsBlocked({ ...fine, titleLink: null, fromUrl: null, originalUrl: "https://blocked.example.test/z" }, [site])).toBe(true);
    expect(cardIsBlocked({ ...fine, titleLink: null, fromUrl: null, removeKey: "url:https://blocked.example.test/z" }, [site])).toBe(true);
  });
});

describe("withLinkPreviews with the author's blocks", () => {
  it("drops Slack's card and the Hub's preview of a blocked link, and keeps the other", () => {
    const out = withLinkPreviews(cards(SLACK), [preview("https://blocked.example.test/hub", "Hub blocked"), preview("https://fine.example.test/hub", "Hub fine")], undefined, [site]);
    expect(titles(out)).toEqual(["Fine", "Hub fine"]);
  });

  it("applies a path rule on a segment boundary and a link rule to that address only", () => {
    const path: PreviewBlock = { scope: "path", host: "fine.example.test", pathPrefix: "/b", url: null };
    expect(titles(withLinkPreviews(cards(SLACK), undefined, undefined, [path]))).toEqual(["Blocked"]);
    const link: PreviewBlock = { scope: "link", host: "blocked.example.test", pathPrefix: null, url: "https://blocked.example.test/other" };
    expect(titles(withLinkPreviews(cards(SLACK), undefined, undefined, [link]))).toEqual(["Blocked", "Fine"]);
  });

  it("shows everything with no rules", () => {
    expect(titles(withLinkPreviews(cards(SLACK), undefined, undefined, undefined))).toEqual(["Blocked", "Fine"]);
  });
});

describe("loading messages whose author blocked a link", () => {
  const row = (over: Partial<MessageRow> = {}): MessageRow => ({
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
    chat_message_contents: { body: "two links", attachments: SLACK },
    ...over,
  });
  const repos = async () => {
    const r = createInMemoryRepos(
      new InMemoryDataset({
        chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null }],
        chatPreviewBlocks: [{ id: "cpbk_AAAAAAAAAAA1", member_id: FERN, scope: "site", host: "blocked.example.test", path_prefix: "", url: "", created_at: "2026-01-01T00:00:00Z" }],
      }),
    );
    await r.chatLinkPreviews.save(MESSAGE, [{ url: "https://blocked.example.test/hub", position: 0, finalUrl: null, kind: "link", status: "ok", title: "Hub blocked", description: "t", siteName: null, imageUrl: null }]);
    return r;
  };
  const authorBlocks = async (ids: string[]) => (await repos()).chatLinkPreviews.blocksOfMembers(ids);

  it("leaves out the cards of a blocked link, also on a message sent before the rule, and reads the authors once", async () => {
    const reader = vi.fn(authorBlocks);
    const out = await buildMessageViews(await repos(), { slackChannelId: null }, [row(), row({ id: "msg_AAAAAAAAAAB1" })], MOSS, undefined, { authorBlocks: reader });
    expect(titles(out.views[0].unfurls ?? [])).toEqual(["Fine"]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith([FERN]);
  });

  it("applies only to messages written in the Hub", async () => {
    const out = await buildMessageViews(await repos(), { slackChannelId: null }, [row({ origin: "slack" })], MOSS, undefined, { authorBlocks });
    expect(titles(out.views[0].unfurls ?? [])).toEqual(["Blocked", "Fine", "Hub blocked"]);
  });

  it("still shows the cards when the rules can't be read", async () => {
    const out = await buildMessageViews(await repos(), { slackChannelId: null }, [row()], MOSS, undefined, {
      authorBlocks: async () => {
        throw new Error("db down");
      },
    });
    expect(titles(out.views[0].unfurls ?? [])).toEqual(["Blocked", "Fine", "Hub blocked"]);
  });
});

describe("loadAuthorBlocks", () => {
  it("asks for nothing when there are no authors, and answers an empty map when the read fails", async () => {
    expect((await loadAuthorBlocks([])).size).toBe(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // No service-role client in a unit test: the failure is swallowed.
    expect((await loadAuthorBlocks([FERN])).size).toBe(0);
  });
});
