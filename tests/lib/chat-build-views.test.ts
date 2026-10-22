import { describe, it, expect, vi } from "vitest";

const names = vi.hoisted(() => ({ userNames: {} as Record<string, string> }));
vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserNames: async () => names.userNames,
  slackUserPhotos: async () => ({}),
}));

import { buildMessageViews, type MessageRow } from "@/lib/chat/load";

const row = (id: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  author_member_id: "member-fern",
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

function fakeSupabase(tables: Record<string, unknown[] | null>) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const f of ["select", "in", "is", "eq", "order", "range"]) chain[f] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: table in tables ? tables[table] : [], error: null });
      return chain;
    },
  } as never;
}

describe("buildMessageViews", () => {
  it("copes with the reactions query returning nothing", async () => {
    const out = await buildMessageViews(fakeSupabase({ chat_reactions: null }), { slackChannelId: null }, [row("m1")], "member-fern");
    expect(out.views[0].reactions).toEqual([]);
  });

  it("leaves deleted messages out entirely", async () => {
    const out = await buildMessageViews(fakeSupabase({}), { slackChannelId: null }, [row("m1", { deleted_at: "2026-10-02T00:00:00Z" })], "member-fern");
    expect(out.views).toEqual([]);
  });

  it("names the other people who reacted, from the directory and from Slack, and not the viewer", async () => {
    names.userNames = { U_SLACK: "Rae & <Co>" };
    const supabase = fakeSupabase({
      member_directory: [{ id: "member-bo", name: "Bo", display_name: "Bo <b>", photo_url: null }, { id: "member-fern", name: "Fern", display_name: null, photo_url: null }],
      chat_reactions: [
        { message_id: "m1", emoji: "tada", member_id: "member-fern", slack_user_id: null },
        { message_id: "m1", emoji: "tada", member_id: "member-bo", slack_user_id: null },
        { message_id: "m1", emoji: "tada", member_id: null, slack_user_id: "U_SLACK" },
        { message_id: "m1", emoji: "tada", member_id: null, slack_user_id: "U_UNKNOWN" },
        { message_id: "m1", emoji: "tada", member_id: null, slack_user_id: null },
      ],
    });
    const out = await buildMessageViews(supabase, { slackChannelId: null }, [row("m1")], "member-fern");
    expect(out.views[0].reactions).toEqual([{ emoji: "tada", count: 5, mine: true, reactors: ["Bo <b>", "Rae & <Co>"] }]);
  });
});
