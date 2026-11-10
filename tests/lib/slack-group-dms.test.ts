import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFakeClock } from "../helpers/fake-clock";

const m = vi.hoisted(() => ({
  status: { connected: true, hasDmScopes: true, slackUserId: "USELF" } as Record<string, unknown>,
  list: vi.fn(),
  members: vi.fn(),
  history: vi.fn(),
  replies: vi.fn(),
  rpc: vi.fn(),
  ensureFile: vi.fn(),
  dataset: null as unknown,
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    conversations = { list: m.list, members: m.members, history: m.history, replies: m.replies, open: vi.fn() };
  },
}));
vi.mock("@/lib/slack-capture", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/slack-capture")>()), ensureSlackFileCopied: m.ensureFile }));
vi.mock("@/lib/chat/slack-post", () => ({ chatSlackWritesEnabled: () => true }));
vi.mock("@/lib/features.server", () => ({ membersWithFeatureForOutreach: async (_r: unknown, _k: string, ids: string[]) => new Set(ids) }));
vi.mock("@/lib/slack-connect", () => ({
  SLACK_DM_SCOPES: ["im:read", "im:history", "im:write", "mpim:history", "files:read"],
  getSlackConnectionStatus: async () => m.status,
  getSlackUserToken: async () => ({ token: "xoxp-test", slackUserId: "USELF" }),
  isDeadTokenError: (e: unknown) => (e as { data?: { error?: string } })?.data?.error === "token_revoked",
}));
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(m.dataset as never) };
});

import { pullMemberDms } from "@/lib/chat/slack-dms";
import { InMemoryDataset } from "@/lib/data/in-memory";

const service = { rpc: (...args: unknown[]) => m.rpc(...args) } as never;
const MEMBER = "mbr_AAAAAAAAAAF1";
const GALE = "mbr_AAAAAAAAAAG1";
const CHAT = "chn_AAAAAAAAAAC9";
const rpcCalls = (name: string) => m.rpc.mock.calls.filter(([n]) => n === name);
const ds = () => m.dataset as InstanceType<typeof InMemoryDataset>;

beforeEach(() => {
  m.status = { connected: true, hasDmScopes: true, slackUserId: "USELF" };
  m.dataset = new InMemoryDataset({ chatSlackAuthors: [{ slack_user_id: "UGALE", member_id: GALE }] });
  m.list.mockReset().mockImplementation(async ({ types }: { types: string }) => ({
    channels: types === "mpim" ? [{ id: "G1", is_mpim: true, name: "mpdm-self--gale--stranger-1", num_members: 3, created: 1_700_000_000 }] : [],
  }));
  m.members.mockReset().mockResolvedValue({ members: ["USELF", "UGALE", "USTRANGER"] });
  m.history.mockReset().mockResolvedValue({ messages: [], has_more: false });
  m.replies.mockReset().mockResolvedValue({ messages: [], has_more: false });
  m.ensureFile.mockReset().mockResolvedValue({ ok: true });
  m.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "chat_claim_slack_dm_pull") return { data: true, error: null };
    if (name === "project_slack_group_dm") return { data: { channel: CHAT }, error: null };
    return { data: { projected: true }, error: null };
  });
});

describe("pullMemberDms: group DMs the bot is not in", () => {
  useFakeClock(() => Date.parse("2026-11-03T12:00:00Z"));

  it("records the group as token only, its members, its messages typed mpim, and projects it as a group", async () => {
    m.history.mockResolvedValue({
      messages: [
        { ts: "1762170000.000200", user: "UGALE", text: "second" },
        { ts: "1762170000.000100", user: "USELF", text: "first" },
      ],
      has_more: false,
    });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 2, incomplete: false, errors: [] });

    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ types: "mpim" }));
    expect(ds().slackChannels).toEqual([expect.objectContaining({ channel_id: "G1", name: "", is_mpim: true, is_im: false, is_private: true, token_only: true })]);
    // The Slack name lists the members: neither stored nor kept in the payload.
    expect(JSON.stringify(ds().slackChannels)).not.toContain("mpdm");
    expect(ds().slackChannelMembers.map((r) => r.user_id).sort()).toEqual(["UGALE", "USELF", "USTRANGER"]);
    expect(ds().slackMessages.map((r) => r.channel_type)).toEqual(["mpim", "mpim"]);
    expect(rpcCalls("project_slack_group_dm")[0][1]).toEqual({ p_channel_id: "G1", p_members: { UGALE: GALE, USELF: MEMBER } });
    expect(rpcCalls("project_slack_dm")).toHaveLength(0);
    expect(rpcCalls("project_slack_chat_message")).toHaveLength(2);
    expect(m.history).toHaveBeenCalledWith(expect.objectContaining({ channel: "G1" }));
  });

  it("pages through the members and marks someone who has left", async () => {
    ds().slackChannels.push({ channel_id: "G1", name: "", is_mpim: true, token_only: true } as never);
    ds().slackChannelMembers.push({ channel_id: "G1", user_id: "UGONE", left_at: null } as never);
    m.members
      .mockResolvedValueOnce({ members: ["USELF"], response_metadata: { next_cursor: "n2" } })
      .mockResolvedValueOnce({ members: ["UGALE"] });
    m.history.mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "hi" }], has_more: false });
    await pullMemberDms(service, MEMBER);
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "G1", cursor: "n2" }));
    expect(ds().slackChannelMembers.find((r) => r.user_id === "UGONE")?.left_at).toBeTruthy();
    expect(ds().slackChannelMembers.find((r) => r.user_id === "UGALE")?.left_at ?? null).toBeNull();
  });

  it("leaves a group the bot reads alone: nothing of its row, members or messages is touched or pulled", async () => {
    ds().slackChannels.push({ channel_id: "G1", name: "bot-name", is_mpim: true, token_only: false } as never);
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0, incomplete: false, errors: [] });
    expect(ds().slackChannels).toEqual([expect.objectContaining({ channel_id: "G1", name: "bot-name", token_only: false })]);
    expect(m.members).not.toHaveBeenCalled();
    expect(m.history).not.toHaveBeenCalled();
    expect(rpcCalls("project_slack_group_dm")).toHaveLength(0);
  });

  it("a group the projection refuses is not pulled", async () => {
    m.history.mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "hi" }], has_more: false });
    m.rpc.mockImplementation(async (name: string) => (name === "project_slack_group_dm" ? { data: { channel: null }, error: null } : { data: true, error: null }));
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0, incomplete: false, errors: [] });
    expect(rpcCalls("project_slack_chat_message")).toHaveLength(0);
  });

  it("only takes Slack's group DMs, not whatever else a list returns", async () => {
    m.list.mockImplementation(async ({ types }: { types: string }) => ({ channels: types === "mpim" ? [{ id: "G2", is_mpim: false }] : [] }));
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0, incomplete: false, errors: [] });
    expect(ds().slackChannels).toEqual([]);
  });

  it("logs a group failing and goes on, and stops on a missing scope", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.list.mockImplementation(async ({ types }: { types: string }) => ({ channels: types === "mpim" ? [{ id: "G1", is_mpim: true }, { id: "G2", is_mpim: true }] : [] }));
    m.history.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "hi" }], has_more: false });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 1, incomplete: false, errors: [expect.stringContaining("boom")] });
    error.mockRestore();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.history.mockReset().mockRejectedValue({ data: { error: "missing_scope" } });
    const stopped = await pullMemberDms(service, MEMBER, { force: true });
    expect(stopped?.errors).toEqual([`member ${MEMBER}: stopped on missing_scope`]);
    expect(m.history).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("copies the files of a group's messages with the member's token", async () => {
    m.history.mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "pic", files: [{ id: "F1", name: "a.png", mimetype: "image/png", size: 10 }] }], has_more: false });
    await pullMemberDms(service, MEMBER);
    expect(m.ensureFile).toHaveBeenCalledWith(expect.anything(), "xoxp-test", expect.objectContaining({ channelId: "G1", fileId: "F1" }));
  });
});
