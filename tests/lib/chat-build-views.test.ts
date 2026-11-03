import { describe, it, expect, vi } from "vitest";

const names = vi.hoisted(() => ({ userNames: {} as Record<string, string>, hubNames: {} as Record<string, string>, hubAsked: [] as string[][] }));
vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async (ids: string[]) => {
    names.hubAsked.push(ids);
    return names.hubNames;
  },
  slackUserNames: async () => names.userNames,
  slackUserPhotos: async () => ({}),
}));

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
});
