import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { withConversationParticipants } from "@/lib/chat/names";

const MEMBER_1 = "mbr_AAAAAAAAAAA1";
const MEMBER_2 = "mbr_AAAAAAAAAAA2";

const dataset = () =>
  new InMemoryDataset({
    slackUsers: [
      { user_id: "U1", display_name: "Ada S", real_name: "Ada Slack", name: "ada" },
      { user_id: "U2", display_name: "Gale", real_name: "Gale Slack", name: "gale" },
      { user_id: "U3", display_name: null, real_name: "Zed <&> Outsider", name: "zed" },
      { user_id: "U4", display_name: "Robo", real_name: "Robo", name: "robo", is_bot: true },
    ],
    slackChannelMembers: [
      { channel_id: "D1", user_id: "U1", left_at: null },
      { channel_id: "D1", user_id: "U2", left_at: null },
      { channel_id: "G1", user_id: "U1", left_at: null },
      { channel_id: "G1", user_id: "U2", left_at: null },
      { channel_id: "G1", user_id: "U3", left_at: null },
      { channel_id: "G1", user_id: "U4", left_at: null },
      { channel_id: "SELF", user_id: "U1", left_at: null },
    ],
    chatSlackAuthors: [
      { slack_user_id: "U1", member_id: MEMBER_1 },
      { slack_user_id: "U2", member_id: MEMBER_2 },
    ],
    members: [
      { id: MEMBER_1, name: "Ada Example" },
      { id: MEMBER_2, name: "Gale Prickleton", displayName: "Gale P" },
    ],
  });

const row = (channel_id: string, channel_type: string) => ({ data: { channel_id, channel_type } });

beforeEach(() => {
  repos = createInMemoryRepos(dataset());
});

describe("withConversationParticipants", () => {
  it("names the others, matched members by Hub name, others by Slack name, skipping bots and the page's member", async () => {
    const out = await withConversationParticipants([row("D1", "im"), row("G1", "mpim")], MEMBER_1);
    expect(out[0].data).toMatchObject({ participants: ["Gale P"], participantCount: 1 });
    expect(out[1].data).toMatchObject({ participants: ["Gale P", "Zed <&> Outsider"], participantCount: 2 });
  });

  it("names the member themself in a conversation with nobody else", async () => {
    const out = await withConversationParticipants([row("SELF", "im")], MEMBER_1);
    expect(out[0].data).toMatchObject({ participants: ["Ada Example"] });
  });

  it("leaves rows alone when they are channels, unknown, or there are no members known", async () => {
    const rows = [{ data: { channel_name: "writing" } }, { data: null }];
    expect(await withConversationParticipants(rows, MEMBER_1)).toBe(rows);
    const unknown = [row("NOPE", "im")];
    expect(await withConversationParticipants(unknown, MEMBER_1)).toEqual(unknown);
  });
});
