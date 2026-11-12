import { unfurlImageSrc, unfurlPictureKey } from "@/lib/chat/unfurl-images";
import { describe, it, expect, vi } from "vitest";

const names = vi.hoisted(() => ({ namesAsked: [] as string[][], userNames: {} as Record<string, string>, hubNames: {} as Record<string, string>, hubAsked: [] as string[][] }));
vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async (ids: string[]) => {
    names.hubAsked.push(ids);
    return names.hubNames;
  },
  slackUserNames: async (ids: string[]) => {
    names.namesAsked.push(ids);
    return names.userNames;
  },
  slackUserPhotos: async () => ({}),
}));

import { APP_URL } from "@/lib/config";
import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const row = (id: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  author_member_id: FERN,
  slack_ts: null,
  created_at: "2026-10-01T00:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body: "hi" },
  ...extra,
});

const FERN = "mbr_AAAAAAAAAAF1";
const BO = "mbr_AAAAAAAAAAF2";

/** The repositories over a dataset of just these reactions (and members, for naming reactors). */
function reposWith(over: ConstructorParameters<typeof InMemoryDataset>[0] = {}) {
  return createInMemoryRepos(new InMemoryDataset(over));
}
const reaction = (n: number, r: { member_id: string | null; slack_user_id: string | null }) => ({ id: `rct_AAAAAAAAAAA${n}`, message_id: "m1", emoji: "tada", ...r });

describe("buildMessageViews", () => {
  it("shows a message whose blocks have an underline from the blocks (a Hub message's body unescaped, a Slack one's escaped), and every other message from its text", async () => {
    const blocks = [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "a < b ", style: { underline: true } }, { type: "text", text: "c" }] }] }];
    const plainBlocks = [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "no underline", style: { bold: true } }] }] }];
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: null },
      [
        row("m1", { origin: "app", chat_message_contents: { body: "a < b c", blocks } }),
        row("m2", { origin: "slack", chat_message_contents: { body: "a &lt; b c", blocks } }),
        row("m3", { origin: "slack", chat_message_contents: { body: "kept text", blocks: plainBlocks } }),
        row("m4", { origin: "app", chat_message_contents: { body: "kept too", blocks: null } }),
      ],
      FERN
    );
    expect(out.views.map((v) => v.body)).toEqual(["<u>a < b </u>c", "<u>a &lt; b </u>c", "kept text", "kept too"]);
  });

  it("looks up Hub names only for people named in notices, and returns them for the page's text context", async () => {
    names.hubAsked.length = 0;
    names.hubNames = { U1: "Cody Ray" };
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: null },
      [
        row("m1", { system_subtype: "channel_join", chat_message_contents: { body: "<@U1> was added to the channel by <@U2>" } }),
        row("m2", { chat_message_contents: { body: "hello <@U3>" } }),
      ],
      FERN
    );
    expect(names.hubAsked).toEqual([["U1", "U2"]]);
    expect(out.hubNames).toEqual({ U1: "Cody Ray" });
    names.hubNames = {};
  });

  it("copes with a message nobody reacted to", async () => {
    const out = await buildMessageViews(reposWith({ chatReactions: [] }), { slackChannelId: null }, [row("m1")], FERN);
    expect(out.views[0].reactions).toEqual([]);
  });

  it("leaves deleted messages out entirely", async () => {
    const out = await buildMessageViews(reposWith(), { slackChannelId: null }, [row("m1", { deleted_at: "2026-10-02T00:00:00Z" })], FERN);
    expect(out.views).toEqual([]);
  });

  it("keeps a deleted thread root that still has replies, with no content", async () => {
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: null },
      [row("m1", { deleted_at: "2026-10-02T00:00:00Z", reply_count: 2 })],
      FERN
    );
    expect(out.views).toHaveLength(1);
    expect(out.views[0]).toMatchObject({ contentState: "deleted", body: null, replyCount: 2 });
  });

  it("names the other people who reacted, from the directory and from Slack, and not the viewer", async () => {
    names.userNames = { U_SLACK: "Rae & <Co>" };
    const repos = reposWith({
      members: [
        { id: BO, name: "Bo", displayName: "Bo <b>" },
        { id: FERN, name: "Fern" },
      ],
      chatReactions: [
        reaction(1, { member_id: FERN, slack_user_id: null }),
        reaction(2, { member_id: BO, slack_user_id: null }),
        reaction(3, { member_id: null, slack_user_id: "U_SLACK" }),
        reaction(4, { member_id: null, slack_user_id: "U_UNKNOWN" }),
        reaction(5, { member_id: null, slack_user_id: null }),
      ],
    });
    const out = await buildMessageViews(repos, { slackChannelId: null }, [row("m1")], FERN);
    expect(out.views[0].reactions).toEqual([{ emoji: "tada", count: 5, mine: true, reactors: ["Bo <b>", "Rae & <Co>"] }]);
  });

  it("marks the messages that share a lesson video and drops the Slack link line Slack's copy ends with", async () => {
    const out = await buildMessageViews(
      reposWith({ chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: "m1", lesson_id: "les_AAAAAAAAAAA1", open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }] }),
      { slackChannelId: null },
      [
        row("m1", { origin: "app", chat_message_contents: { body: "This helped\n<https://hub.example.com/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1|Watch it in Hub Chat> · <https://hub.example.com/courses/ready-writer/lessons/les_AAAAAAAAAAA1|Open the lesson>" } }),
        row("m2", { origin: "app", chat_message_contents: { body: "No video\n<https://hub.example.com/courses/ready-writer/lessons/les_AAAAAAAAAAA1|Watch the video>" } }),
      ],
      FERN
    );

    expect(out.views.map((v) => [v.sharesVideo, v.body])).toEqual([
      [true, "This helped"],
      [false, "No video\n<https://hub.example.com/courses/ready-writer/lessons/les_AAAAAAAAAAA1|Watch the video>"],
    ]);
  });

  it("keeps a deleted video's thread reachable without its video card or attachments", async () => {
    const out = await buildMessageViews(
      reposWith({ chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: "m1", lesson_id: "les_AAAAAAAAAAA1", open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }] }),
      { slackChannelId: null },
      [row("m1", { deleted_at: "2026-10-02T00:00:00Z", reply_count: 2, has_files: true, chat_message_contents: { body: "This message was deleted.", files: [{ id: "F1", name: "old.png" }] } })],
      FERN
    );
    expect(out.views[0]).toMatchObject({ contentState: "deleted", body: null, sharesVideo: false, files: [], replyCount: 2 });
  });

  it("still lists the messages when the shared videos can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = reposWith();
    repos.chatVideos.lessonIdsOf = async () => {
      throw new Error("db down");
    };

    const out = await buildMessageViews(repos, { slackChannelId: null }, [row("m1")], FERN);

    expect(out.views.map((v) => [v.body, v.sharesVideo])).toEqual([["hi", false]]);
  });

  it("hides the lesson address a Slack message was posted with once it is the video card, and keeps any other text", async () => {
    const address = `${APP_URL}/courses/ready-writer/lessons/les_AAAAAAAAAAA1`;
    const out = await buildMessageViews(
      reposWith({ chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: "m1", lesson_id: "les_AAAAAAAAAAA1", open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }] }),
      { slackChannelId: null },
      [
        row("m1", { origin: "slack", chat_message_contents: { body: `this helped <${address}|here> a lot` } }),
        row("m2", { origin: "slack", chat_message_contents: { body: address } }),
      ],
      FERN
    );

    expect(out.views[0].body).toBe("this helped a lot");
    expect(out.views[0].sharesVideo).toBe(true);
    // A message with no card keeps its address: it is just a link.
    expect(out.views[1].body).toBe(address);
    expect(out.views[1].sharesVideo).toBe(false);
  });

  it("carries the cards under a message, with the people they mention looked up and a Slack address for what the Hub cannot draw", async () => {
    names.namesAsked.length = 0;
    const attachments = [{ title: "A page", title_link: "https://example.com/a", text: "thanks <@UMENTIONED>" }];
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: "C123" },
      [
        row("m1", { slack_ts: "1700000000.000100", chat_message_contents: { body: "see https://example.com/a", attachments } }),
        row("m2", { chat_message_contents: { body: "plain" } }),
      ],
      FERN
    );
    expect(out.views[0].unfurls?.map((u) => u.kind)).toEqual(["card"]);
    expect(out.views[0].hideBody).toBe(false);
    expect(out.views[0].slackPermalink).toMatch(/\/archives\/C123\/p1700000000000100$/);
    expect(out.views[1].unfurls).toEqual([]);
    expect(out.views[1].slackPermalink).toBeNull();
    expect(names.namesAsked.flat()).toContain("UMENTIONED");
  });

  it("draws an app's blocks instead of its fallback text, and shows the app by its own name and logo", async () => {
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "*Deployed*" } }];
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: null },
      [
        row("m1", { author_member_id: null, chat_message_contents: { body: "Deployed", blocks, bot: { name: "Deploys", icon: "https://example.com/i.png" } } }),
        // A person's message with the same blocks keeps its text; so does an unknown app.
        row("m2", { author_member_id: null, chat_message_contents: { body: "Deployed", blocks } }),
        row("m3", { author_member_id: null, chat_message_contents: { body: "x", blocks, bot: { name: "  ", icon: "javascript:1" } } }),
        row("m4", { author_member_id: null, chat_message_contents: { body: "x", bot: { name: "No icon", icon: "http://insecure.example/i.png" } } }),
      ],
      FERN
    );
    expect(out.views[0]).toMatchObject({ authorName: "Deploys", authorPhotoUrl: unfurlImageSrc("m1", unfurlPictureKey("https://example.com/i.png")), hideBody: true });
    expect(out.views[0].unfurls?.map((u) => u.kind)).toEqual(["blocks"]);
    expect(out.views[1]).toMatchObject({ authorName: "Someone on Slack", hideBody: false, unfurls: [] });
    expect(out.views[2]).toMatchObject({ authorName: "Someone on Slack", hideBody: false, unfurls: [] });
    expect(out.views[3]).toMatchObject({ authorName: "No icon", authorPhotoUrl: null });
  });

  it("draws no cards for a message that is deleted or hidden", async () => {
    const out = await buildMessageViews(
      reposWith(),
      { slackChannelId: null },
      [row("m1", { deleted_at: "2026-10-02T00:00:00Z", reply_count: 1, chat_message_contents: { body: "x", attachments: [{ title: "T" }] } })],
      FERN
    );
    expect(out.views[0].unfurls).toEqual([]);
  });
});
