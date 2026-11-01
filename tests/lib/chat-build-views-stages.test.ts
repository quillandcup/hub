import { describe, it, expect, vi, beforeEach } from "vitest";

const log = vi.hoisted(() => ({ events: [] as string[], gate: null as null | Promise<void> }));
vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async (n: string[]) => (log.events.push("emoji"), Object.fromEntries(n.map((x) => [x, { url: x }]))),
  slackAuthorIdsByTs: async (_c: string, tss: string[]) => {
    log.events.push("authorsByTs");
    await log.gate;
    return Object.fromEntries(tss.map((t) => [t, `U_${t.replace(".", "")}`]));
  },
  slackChannelNames: async () => (log.events.push("channelNames"), {}),
  slackUserMemberIds: async () => (log.events.push("userMembers"), {}),
  slackUserHubNames: async () => (log.events.push("hubNames"), {}),
  slackUserNames: async (ids: string[]) => (log.events.push("userNames"), Object.fromEntries(ids.map((i) => [i, `Name ${i}`]))),
  slackUserPhotos: async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, `https://example.com/${i}.png`])),
}));

import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const row = (id: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  author_member_id: "mbr_AAAAAAAAAAA1",
  slack_ts: null,
  created_at: "2026-10-01T00:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body: "hi :party:" },
  ...extra,
});

type Seed = NonNullable<ConstructorParameters<typeof InMemoryDataset>[0]>;

/** The twin repositories; reading the directory or the reactions logs "q:member_directory" / "q:chat_reactions". */
function fake(over: Seed) {
  const repos = createInMemoryRepos(new InMemoryDataset({ members: dir, ...over }));
  const byIds = repos.directory.byIds.bind(repos.directory);
  repos.directory.byIds = async (ids) => (log.events.push("q:member_directory"), byIds(ids));
  const reactionRows = repos.chat.reactionRows.bind(repos.chat);
  repos.chat.reactionRows = async (ids) => (log.events.push("q:chat_reactions"), reactionRows(ids));
  return repos;
}

const dir = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" },
  { id: "mbr_BBBBBBBBBBB2", name: "Bea Example", displayName: "Bea" },
  { id: "mbr_CCCCCCCCCCC3", name: "Cy Example" },
];
const CH = "chn_AAAAAAAAAAA1";
const reply = (id: string, root: string, author: string | null, ts: string) => ({ id, channel_id: CH, thread_root_id: root, author_member_id: author, slack_ts: ts, created_at: "2026-10-01T00:00:01Z" });
const reaction = (id: string, member_id: string | null, slack_user_id: string | null) => ({ id, message_id: "msg_1", emoji: "tada", member_id, slack_user_id });

beforeEach(() => {
  log.events.length = 0;
  log.gate = null;
});

describe("buildMessageViews lookups", () => {
  it("resolves unmatched authors, repliers with and without a member, and member and Slack reactors", async () => {
    const tables: Seed = {
      chatMessages: [reply("msg_r1", "msg_1", "mbr_BBBBBBBBBBB2", "5.1"), reply("msg_r2", "msg_1", null, "6.2")],
      chatReactions: [reaction("rct_AAAAAAAAAAA1", "mbr_CCCCCCCCCCC3", null), reaction("rct_AAAAAAAAAAA2", null, "U_R"), reaction("rct_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA1", null)],
    };
    const out = await buildMessageViews(
      fake(tables),
      { slackChannelId: "C1" },
      [row("msg_1", { reply_count: 2 }), row("msg_2", { author_member_id: null, slack_ts: "1.1" })],
      "mbr_AAAAAAAAAAA1"
    );
    expect(out.views[0].authorName).toBe("Ada Example");
    expect(out.views[0].replyAuthors).toEqual([
      { name: "Bea", photoUrl: null },
      { name: "Name U_62", photoUrl: "https://example.com/U_62.png" },
    ]);
    expect(out.views[0].reactions).toEqual([{ emoji: "tada", count: 3, mine: true, reactors: ["Cy Example", "Name U_R"] }]);
    expect(out.views[1]).toMatchObject({ authorMemberId: null, authorName: "Name U_11" });
    expect(Object.keys(out.userNames).sort()).toEqual(["U_11", "U_62", "U_R"]);
    expect(Object.keys(out.customEmoji).sort()).toEqual(["party", "tada"]);
  });

  it("looks up profiles for authors, repliers and reactors in two directory queries, not three", async () => {
    const tables: Seed = {
      chatMessages: [reply("msg_r1", "msg_1", "mbr_BBBBBBBBBBB2", "5.1")],
      chatReactions: [reaction("rct_AAAAAAAAAAA1", "mbr_CCCCCCCCCCC3", null)],
    };
    await buildMessageViews(fake(tables), { slackChannelId: null }, [row("msg_1", { reply_count: 1 })], "mbr_AAAAAAAAAAA1");
    expect(log.events.filter((e) => e === "q:member_directory")).toHaveLength(2);
  });

  it("starts independent lookups before slower ones finish", async () => {
    let release!: () => void;
    log.gate = new Promise<void>((r) => (release = r));
    const tables: Seed = { chatMessages: [reply("msg_r1", "msg_1", null, "6.2")] };
    const done = buildMessageViews(
      fake(tables),
      { slackChannelId: "C1" },
      [row("msg_1", { reply_count: 1, author_member_id: null, slack_ts: "1.1" })],
      "mbr_AAAAAAAAAAA1"
    );
    await new Promise((r) => setTimeout(r, 10));
    // The first slackAuthorIdsByTs is still pending, yet the other lookups have already started.
    expect(log.events).toEqual(expect.arrayContaining(["authorsByTs", "userMembers", "hubNames", "channelNames", "q:chat_reactions"]));
    expect(log.events).not.toContain("userNames");
    release();
    await done;
    expect(log.events).toContain("userNames");
  });
});
