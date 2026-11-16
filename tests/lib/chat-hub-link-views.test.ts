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

import { APP_URL } from "@/lib/config";
import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const FERN = "mbr_AAAAAAAAAAF1";
const MSG = "msg_AAAAAAAAAAA1";
const ADDRESS = `${APP_URL}/prickles/prkl_AAAAAAAAAAA1`;

/** Slack's preview of a link to the Hub: the sign-in page its crawler was sent to. */
const loginCard = { title: "Login | Hedgie Hub", title_link: ADDRESS, original_url: ADDRESS, service_name: "Hub" };
const otherCard = { title: "Elsewhere", title_link: "https://other.example.test/a", original_url: "https://other.example.test/a" };

const row = (body: string, attachments: unknown[] = [loginCard, otherCard]): MessageRow => ({
  id: MSG,
  author_member_id: FERN,
  slack_ts: null,
  created_at: "2026-10-01T00:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body, attachments },
});

const views = (message: MessageRow, hubLinkCards?: () => Promise<boolean>, dataset: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  buildMessageViews(createInMemoryRepos(new InMemoryDataset(dataset)), { slackChannelId: null }, [message], FERN, undefined, { hubLinkCards }).then((out) => out.views[0]);
const kinds = (v: { unfurls?: { kind: string }[] }) => (v.unfurls ?? []).map((u) => u.kind);

describe("links to the Hub in a message's views", () => {
  it("with the viewer's flag on: a card for the link, Slack's sign-in card gone and its other cards kept", async () => {
    const view = await views(row(`look ${ADDRESS}`), async () => true);
    expect(kinds(view)).toEqual(["card", "hub"]);
    expect(view.unfurls?.[0]).toMatchObject({ title: "Elsewhere" });
    expect(view.unfurls?.[1]).toMatchObject({ kind: "hub", url: ADDRESS, link: { kind: "prickle", prickleId: "prkl_AAAAAAAAAAA1" }, removeKey: `url:${ADDRESS}` });
    // The text, with the link in it, is still there.
    expect(view.body).toContain(ADDRESS);
  });

  it("with the flag off, or no way to ask: today's cards and no Hub card", async () => {
    for (const ask of [async () => false, undefined, async () => { throw new Error("lookup failed"); }]) {
      expect(kinds(await views(row(`look ${ADDRESS}`), ask))).toEqual(["card", "card"]);
    }
  });

  it("asks for the flag only when a message has a link to the Hub", async () => {
    const ask = vi.fn(async () => true);
    await views(row("no links here, or https://other.example.test/a"), ask);
    expect(ask).not.toHaveBeenCalled();
    await views(row(`here ${ADDRESS}`), ask);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("leaves out a card its author removed, and still drops Slack's sign-in card", async () => {
    const hidden = [{ message_id: MSG, key: `url:${ADDRESS}`, hidden_at: "2026-10-02T00:00:00Z" }] as never;
    const view = await views(row(`look ${ADDRESS}`), async () => true, { chatHiddenUnfurls: hidden });
    expect(kinds(view)).toEqual(["card"]);
    expect(view.unfurls?.[0]).toMatchObject({ title: "Elsewhere" });
  });

  it("does not make a card for an address on another site, or inside code", async () => {
    const view = await views(row(`https://other.example.test/prickles/prkl_AAAAAAAAAAA1 and \`${ADDRESS}\``, []), async () => true);
    expect(kinds(view)).toEqual([]);
  });
});
