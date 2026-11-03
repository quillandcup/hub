import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFakeClock } from "../helpers/fake-clock";

const m = vi.hoisted(() => ({
  writes: true,
  status: { connected: true, hasDmScopes: true, slackUserId: "USELF" } as Record<string, unknown>,
  token: { token: "xoxp-test", slackUserId: "USELF" } as { token: string; slackUserId: string } | null,
  claimed: true,
  list: vi.fn(),
  history: vi.fn(),
  open: vi.fn(),
  rpc: vi.fn(),
  dataset: null as unknown,
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    conversations = { list: m.list, history: m.history, open: m.open };
  },
}));
vi.mock("@/lib/chat/slack-post", () => ({ chatSlackWritesEnabled: () => m.writes }));
vi.mock("@/lib/slack-connect", () => ({
  getSlackConnectionStatus: async () => m.status,
  getSlackUserToken: async () => m.token,
  isDeadTokenError: (e: unknown) => (e as { data?: { error?: string } })?.data?.error === "token_revoked",
}));
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(m.dataset as never) };
});

import { openSlackDm, pullMemberDms, SLACK_DM_PULL_INTERVAL_SECONDS } from "@/lib/chat/slack-dms";
import { InMemoryDataset } from "@/lib/data/in-memory";

const service = { rpc: (...args: unknown[]) => m.rpc(...args) } as never;
const MEMBER = "mbr_AAAAAAAAAAF1";
const GALE = "mbr_AAAAAAAAAAG1";
const CHAT = "chn_AAAAAAAAAAC1";
const rpcCalls = (name: string) => m.rpc.mock.calls.filter(([n]) => n === name);

beforeEach(() => {
  m.writes = true;
  m.status = { connected: true, hasDmScopes: true, slackUserId: "USELF" };
  m.token = { token: "xoxp-test", slackUserId: "USELF" };
  m.claimed = true;
  m.dataset = new InMemoryDataset({ chatSlackAuthors: [{ slack_user_id: "UGALE", member_id: GALE }] });
  m.list.mockReset().mockResolvedValue({ channels: [{ id: "D1", user: "UGALE", created: 1_700_000_000 }] });
  m.history.mockReset().mockResolvedValue({ messages: [], has_more: false });
  m.open.mockReset().mockResolvedValue({ ok: true, channel: { id: "D1" } });
  m.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "chat_claim_slack_dm_pull") return { data: m.claimed, error: null };
    if (name === "project_slack_dm") return { data: { channel: CHAT }, error: null };
    return { data: { projected: true }, error: null };
  });
});

describe("pullMemberDms", () => {
  useFakeClock(() => Date.parse("2026-11-03T12:00:00Z"));

  it("lists the member's DMs with their own token and stores the conversation, its two people and its messages", async () => {
    m.history.mockResolvedValue({
      messages: [
        { ts: "1762170000.000200", user: "UGALE", text: "second" },
        { ts: "1762170000.000100", user: "USELF", text: "first &amp; <b>" },
        { ts: "1762170000.000300", subtype: "channel_join", user: "UGALE" },
        { ts: "1762170000.000400", subtype: "bot_message", bot_id: "B1", text: "skipped" },
      ],
      has_more: false,
    });
    const ds = m.dataset as InMemoryDataset;
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 3 });

    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ types: "im" }));
    expect(ds.slackChannels).toEqual([expect.objectContaining({ channel_id: "D1", is_im: true, is_mpim: false, is_private: true, im_user_id: "UGALE" })]);
    expect(ds.slackChannelMembers.map((r) => r.user_id).sort()).toEqual(["UGALE", "USELF"]);
    expect(ds.slackMessages.map((r) => [r.message_ts, r.channel_type]).sort()).toEqual([
      ["1762170000.000100", "im"],
      ["1762170000.000200", "im"],
      ["1762170000.000300", "im"],
    ]);
    // Into the chat: the conversation with both people, then each message oldest first.
    expect(rpcCalls("project_slack_dm")[0][1]).toEqual({ p_channel_id: "D1", p_members: { USELF: MEMBER, UGALE: GALE } });
    expect(rpcCalls("project_slack_chat_message").map(([, args]) => args.p_message_ts)).toEqual([
      "1762170000.000100",
      "1762170000.000200",
      "1762170000.000300",
    ]);
  });

  it("goes back 90 days on the first pull, then only past what the chat already has", async () => {
    await pullMemberDms(service, MEMBER);
    const ninetyDaysAgo = Math.floor(Date.parse("2026-11-03T12:00:00Z") / 1000) - 90 * 86400;
    expect(m.history).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "D1", oldest: String(ninetyDaysAgo) }));

    (m.dataset as InMemoryDataset).chatMessages.push({ id: "msg_AAAAAAAAAAD1", channel_id: CHAT, slack_ts: "1762170000.000200", created_at: "2026-11-03T11:00:00Z" } as never);
    await pullMemberDms(service, MEMBER);
    expect(m.history).toHaveBeenLastCalledWith(expect.objectContaining({ oldest: "1762170000.000200", inclusive: false }));
  });

  it("only knows the other person as a Hub member when they are one", async () => {
    m.list.mockResolvedValue({ channels: [{ id: "D2", user: "USTRANGER" }] });
    await pullMemberDms(service, MEMBER);
    expect(rpcCalls("project_slack_dm")[0][1].p_members).toEqual({ USELF: MEMBER });
  });

  it("skips Slackbot's conversation and a deactivated person's", async () => {
    m.list.mockResolvedValue({ channels: [{ id: "D3", user: "USLACKBOT" }, { id: "D4", user: "UGONE", is_user_deleted: true }, { id: "D5" }] });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0 });
    expect(m.history).not.toHaveBeenCalled();
  });

  it("does nothing off production, without the DM scopes or a connection, when pulled a moment ago, or without a usable token", async () => {
    m.writes = false;
    await expect(pullMemberDms(service, MEMBER)).resolves.toBeNull();
    m.writes = true;
    m.status = { connected: true, hasDmScopes: false, slackUserId: "USELF" };
    await expect(pullMemberDms(service, MEMBER)).resolves.toBeNull();
    m.status = { connected: false, hasDmScopes: false, slackUserId: null };
    await expect(pullMemberDms(service, MEMBER)).resolves.toBeNull();
    m.status = { connected: true, hasDmScopes: true, slackUserId: "USELF" };
    m.claimed = false;
    await expect(pullMemberDms(service, MEMBER)).resolves.toBeNull();
    expect(rpcCalls("chat_claim_slack_dm_pull")[0][1]).toEqual({ p_member: MEMBER, p_min_seconds: SLACK_DM_PULL_INTERVAL_SECONDS });
    m.claimed = true;
    m.token = null;
    await expect(pullMemberDms(service, MEMBER)).resolves.toBeNull();
    expect(m.list).not.toHaveBeenCalled();
  });

  it("revokes a connection Slack no longer honours, and stops on a missing scope or a rate limit", async () => {
    m.list.mockRejectedValue({ data: { error: "token_revoked" } });
    await pullMemberDms(service, MEMBER);
    expect(rpcCalls("slack_connection_revoke")).toHaveLength(1);

    m.rpc.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.list.mockResolvedValue({ channels: [{ id: "D1", user: "UGALE" }, { id: "D6", user: "UOTHER" }] });
    m.history.mockRejectedValue({ data: { error: "missing_scope" } });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0 });
    expect(m.history).toHaveBeenCalledTimes(1); // the second DM was not tried
    expect(rpcCalls("slack_connection_revoke")).toHaveLength(0);
    warn.mockRestore();
  });

  it("logs one DM failing and goes on with the next", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.list.mockResolvedValue({ channels: [{ id: "D1", user: "UGALE" }, { id: "D6", user: "UOTHER" }] });
    m.history.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UOTHER", text: "hi" }], has_more: false });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 1 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reads further pages of a long DM", async () => {
    m.history
      .mockResolvedValueOnce({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "a" }], has_more: true, response_metadata: { next_cursor: "c2" } })
      .mockResolvedValueOnce({ messages: [{ ts: "1762170000.000200", user: "UGALE", text: "b" }], has_more: false });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 2 });
    expect(m.history).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c2" }));
  });
});

describe("openSlackDm", () => {
  useFakeClock(() => Date.parse("2026-11-03T12:00:00Z"));

  it("opens the member's DM with the other person using the member's own token, and brings it into the chat", async () => {
    m.history.mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "hi" }], has_more: false });
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: true, channelId: CHAT });
    expect(m.open).toHaveBeenCalledWith({ users: "UGALE", return_im: true });
    expect(rpcCalls("project_slack_dm")[0][1]).toEqual({ p_channel_id: "D1", p_members: { USELF: MEMBER, UGALE: GALE } });
    expect((m.dataset as InMemoryDataset).slackMessages).toHaveLength(1);
    expect(rpcCalls("chat_claim_slack_dm_pull")).toHaveLength(0); // opening a DM isn't throttled
  });

  it("does nothing off production, without the DM scopes or a token, or for a person with no known Slack id", async () => {
    m.writes = false;
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "not_production" });
    m.writes = true;
    m.status = { connected: true, hasDmScopes: false, slackUserId: "USELF" };
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "not_connected" });
    m.status = { connected: true, hasDmScopes: true, slackUserId: "USELF" };
    m.token = null;
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "not_connected" });
    m.token = { token: "xoxp-test", slackUserId: "USELF" };
    await expect(openSlackDm(service, MEMBER, "mbr_AAAAAAAAAAH1")).resolves.toEqual({ ok: false, reason: "unknown_person" });
    expect(m.open).not.toHaveBeenCalled();
  });

  it("revokes a connection Slack no longer honours, and reports Slack refusing or failing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.open.mockRejectedValueOnce({ data: { error: "token_revoked" } });
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "not_connected" });
    expect(rpcCalls("slack_connection_revoke")).toHaveLength(1);
    m.open.mockRejectedValueOnce(new Error("boom"));
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "slack_refused" });
    m.open.mockResolvedValueOnce({ ok: true, channel: {} });
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "slack_refused" });
    m.rpc.mockImplementation(async (name: string) => (name === "project_slack_dm" ? { data: { channel: null }, error: null } : { data: true, error: null }));
    await expect(openSlackDm(service, MEMBER, GALE)).resolves.toEqual({ ok: false, reason: "slack_refused" });
    error.mockRestore();
  });
});
