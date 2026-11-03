import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFakeClock } from "../helpers/fake-clock";

const m = vi.hoisted(() => ({
  writes: true,
  status: { connected: true, hasDmScopes: true, slackUserId: "USELF" } as Record<string, unknown>,
  token: { token: "xoxp-test", slackUserId: "USELF" } as { token: string; slackUserId: string } | null,
  claimed: true,
  covered: new Set<string>(),
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
vi.mock("@/lib/features.server", () => ({
  membersWithFeatureForOutreach: async (_repos: unknown, _key: string, ids: string[]) => new Set(ids.filter((id) => m.covered.has(id))),
}));
vi.mock("@/lib/slack-connect", () => ({
  SLACK_DM_SCOPES: ["im:read", "im:history", "im:write", "mpim:history", "files:read"],
  getSlackConnectionStatus: async () => m.status,
  getSlackUserToken: async () => m.token,
  isDeadTokenError: (e: unknown) => (e as { data?: { error?: string } })?.data?.error === "token_revoked",
}));
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(m.dataset as never) };
});

import { openSlackDm, pullDmsForCoveredMembers, pullMemberDms, SLACK_DM_PULL_INTERVAL_SECONDS } from "@/lib/chat/slack-dms";
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
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 3, errors: [] });

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

  it("skips the interval when forced (a live event named a DM we hadn't seen)", async () => {
    await pullMemberDms(service, MEMBER, { force: true });
    expect(rpcCalls("chat_claim_slack_dm_pull")[0][1]).toEqual({ p_member: MEMBER, p_min_seconds: 0 });
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
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0, errors: [] });
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
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 0, messages: 0, errors: [`member ${MEMBER}: stopped on missing_scope`] });
    expect(m.history).toHaveBeenCalledTimes(1); // the second DM was not tried
    expect(rpcCalls("slack_connection_revoke")).toHaveLength(0);
    warn.mockRestore();
  });

  it("logs one DM failing and goes on with the next", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.list.mockResolvedValue({ channels: [{ id: "D1", user: "UGALE" }, { id: "D6", user: "UOTHER" }] });
    m.history.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UOTHER", text: "hi" }], has_more: false });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 1, errors: [expect.stringContaining("boom")] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reads further pages of a long DM", async () => {
    m.history
      .mockResolvedValueOnce({ messages: [{ ts: "1762170000.000100", user: "UGALE", text: "a" }], has_more: true, response_metadata: { next_cursor: "c2" } })
      .mockResolvedValueOnce({ messages: [{ ts: "1762170000.000200", user: "UGALE", text: "b" }], has_more: false });
    await expect(pullMemberDms(service, MEMBER)).resolves.toEqual({ conversations: 1, messages: 2, errors: [] });
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

describe("pullDmsForCoveredMembers", () => {
  useFakeClock(() => Date.parse("2026-11-03T12:00:00Z"));
  const DM_SCOPES = ["im:read", "im:history", "im:write", "mpim:history", "files:read"];
  const OTHER = "mbr_AAAAAAAAAAH1";
  const later = () => Date.parse("2026-11-03T12:00:00Z") + 60_000;
  const connection = (member_id: string, scopes: string[], revoked_at: string | null = null) =>
    ({ member_id, slack_user_id: `U_${member_id}`, team_id: null, scopes, connected_at: "2026-11-01T00:00:00Z", revoked_at, expires_at: null, read_pulled_at: null, dms_pulled_at: null, access_secret_id: null, refresh_secret_id: null }) as never;

  beforeEach(() => {
    m.dataset = new InMemoryDataset({
      slackConnections: [connection(MEMBER, DM_SCOPES), connection(GALE, DM_SCOPES), connection(OTHER, DM_SCOPES.slice(1)), connection("mbr_AAAAAAAAAAJ1", DM_SCOPES, "2026-11-02T00:00:00Z")],
    });
    m.covered = new Set([MEMBER, GALE, OTHER, "mbr_AAAAAAAAAAJ1"]);
  });

  it("pulls, ignoring the interval, the DMs of covered members with a working connection and the DM scopes", async () => {
    m.list.mockResolvedValue({ channels: [{ id: "D1", user: "UX" }] });
    m.history.mockResolvedValue({ messages: [{ ts: "1762170000.000100", user: "UX", text: "hi" }], has_more: false });
    const result = await pullDmsForCoveredMembers(service, { deadline: later() });
    // The member without every scope and the revoked connection are left out; the other two are pulled (each with a token mock).
    expect(result).toEqual({ members: 2, conversations: 2, messages: 2, deferred: 0, errors: [] });
    expect(rpcCalls("chat_claim_slack_dm_pull").map(([, args]) => args.p_min_seconds)).toEqual([0, 0]);
  });

  it("leaves out members the feature doesn't cover", async () => {
    m.covered = new Set([GALE]);
    const result = await pullDmsForCoveredMembers(service, { deadline: later() });
    expect(result.members).toBe(1);
    expect(m.list).toHaveBeenCalledTimes(1);
  });

  it("stops starting members when the time is up, and says how many are left", async () => {
    const result = await pullDmsForCoveredMembers(service, { deadline: Date.parse("2026-11-03T11:59:00Z") });
    expect(result).toEqual({ members: 2, conversations: 0, messages: 0, deferred: 2, errors: [] });
    expect(m.list).not.toHaveBeenCalled();
  });

  it("reports what went wrong for a member and goes on with the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.list.mockRejectedValueOnce({ data: { error: "missing_scope" } }).mockResolvedValue({ channels: [] });
    const result = await pullDmsForCoveredMembers(service, { deadline: later() });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/stopped on missing_scope/);
    expect(m.list).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("is not stopped by a member's pull throwing", async () => {
    m.rpc.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    const result = await pullDmsForCoveredMembers(service, { deadline: later() });
    expect(result.errors).toEqual([expect.stringContaining("db down")]);
    expect(m.list).toHaveBeenCalledTimes(1);
  });
});
