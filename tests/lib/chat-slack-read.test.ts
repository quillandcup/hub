import { describe, it, expect, vi, beforeEach } from "vitest";

const { info, mark, config, getSlackUserToken } = vi.hoisted(() => ({
  info: vi.fn(),
  mark: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return {
      conversations: {
        info: (a: unknown) => info(a, token),
        mark: (a: unknown) => mark(a, token),
      },
    };
  }),
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  get isProduction() {
    return config.isProduction;
  },
}));
vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  getSlackUserToken: (...args: unknown[]) => getSlackUserToken(...args),
}));

import { pullReadFromSlack, pushReadToSlack, slackReadCovers } from "@/lib/chat/slack-read";

/** The conversation the member read in the Hub (`chan-1`), and the newest Slack message in it at or before `through`. */
let channel: Record<string, unknown> | null;
let newest: Record<string, unknown> | null;
/** The conversations the member is in. */
let memberships: { channelId: string; slack: string | null; extra: Record<string, unknown> }[];
/** Chat repository methods that throw. */
let failing: string[];
let claim: boolean;
/** What chat_unread_channel_ids answers; null = the function isn't available (errors or empty). */
let unread: { data: unknown; error?: { message: string } | null } | null;
const rpc = vi.fn();

// The conversations and memberships come from the chat repository, here in memory.
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => {
      const channels = new Map<string, Record<string, unknown>>();
      if (channel) channels.set("chan-1", { id: "chan-1", ...channel });
      for (const mm of memberships) channels.set(mm.channelId, { id: mm.channelId, slack_channel_id: mm.slack, ...mm.extra });
      const repos = actual.createInMemoryRepos(
        new InMemoryDataset({
          chatChannels: [...channels.values()] as never,
          chatChannelMembers: memberships.map((mm) => ({ channel_id: mm.channelId, member_id: "member-fern" })),
          chatMessages: newest ? [{ id: "msg_1", channel_id: "chan-1", created_at: "2026-10-10T09:00:00Z", ...newest }] : [],
        })
      );
      for (const method of failing) (repos.chat as unknown as Record<string, unknown>)[method] = async () => { throw new Error(`${method} failed`); };
      return repos;
    },
  };
});

const service = {
  rpc: (name: string, args: unknown) => rpc(name, args),
  from: (table: string) => {
    throw new Error(`direct query on ${table}`);
  },
} as never;

const membership = (channelId: string, slackChannelId: string | null, extra: Record<string, unknown> = {}) => ({
  channelId,
  slack: slackChannelId,
  extra: { archived_at: null, bridge_disabled: false, ...extra },
});

beforeEach(() => {
  config.isProduction = true;
  channel = { slack_channel_id: "C_HOSTS" };
  newest = { slack_ts: "1700000000.000200" };
  memberships = [];
  failing = [];
  claim = true;
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  info.mockReset();
  info.mockResolvedValue({ ok: true, channel: { last_read: "1700000000.000100" } });
  mark.mockReset();
  mark.mockResolvedValue({ ok: true });
  rpc.mockReset();
  unread = null;
  rpc.mockImplementation(async (name: string) => {
    if (name === "chat_claim_slack_read_pull") return { data: claim };
    if (name === "chat_unread_channel_ids") return unread ?? { data: null, error: null };
    return { data: null, error: null };
  });
});

describe("slackReadCovers", () => {
  it("compares Slack timestamps exactly", () => {
    expect(slackReadCovers("1700000000.000200", "1700000000.000200")).toBe(true);
    expect(slackReadCovers("1700000000.000199", "1700000000.000200")).toBe(false);
    expect(slackReadCovers("1700000001.000000", "1700000000.999999")).toBe(true);
  });
  it("treats a never-read or missing marker as covering nothing", () => {
    expect(slackReadCovers("0000000000.000000", "1700000000.000200")).toBe(false);
    expect(slackReadCovers(undefined, "1700000000.000200")).toBe(false);
  });
});

describe("pushReadToSlack", () => {
  const OPTS = { memberId: "member-fern", channelId: "chan-1", through: "2026-10-10T10:00:00.123456+00:00" };

  it("moves the member's Slack marker to the newest message they read", async () => {
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(true);
    expect(mark).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000200" }, "xoxp-fern");
  });

  it("never moves Slack's marker backward", async () => {
    info.mockResolvedValue({ ok: true, channel: { last_read: "1700000005.000000" } });
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it("does nothing outside production, without a Slack-side message, or without a connection", async () => {
    config.isProduction = false;
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    config.isProduction = true;
    newest = null;
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    newest = { slack_ts: "1700000000.000200" };
    getSlackUserToken.mockResolvedValue(null);
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it("does nothing when it can't read the conversation or its newest message", async () => {
    failing = ["slackChannelOf"];
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    failing = ["newestSlackTs"];
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it("revokes a dead connection and stays quiet about a missing scope", async () => {
    info.mockRejectedValue({ data: { error: "token_revoked" } });
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });

    rpc.mockClear();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    info.mockRejectedValue({ data: { error: "missing_scope" } });
    await expect(pushReadToSlack(service, OPTS)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("pullReadFromSlack", () => {
  it("moves the Hub marker to Slack's, for each bridged conversation the member is in", async () => {
    memberships = [membership("chan-1", "C_ONE"), membership("chan-2", "C_TWO")];
    info.mockImplementation(async ({ channel: id }: { channel: string }) => ({ ok: true, channel: { last_read: id === "C_ONE" ? "1700000000.000100" : "1700000009.000000" } }));
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("chat_apply_slack_read", { p_member: "member-fern", p_channel_id: "chan-1", p_slack_ts: "1700000000.000100" });
    expect(rpc).toHaveBeenCalledWith("chat_apply_slack_read", { p_member: "member-fern", p_channel_id: "chan-2", p_slack_ts: "1700000009.000000" });
  });

  it("skips the open conversation, archived and unbridged ones, and conversations Slack has never seen them read", async () => {
    memberships = [
      membership("open", "C_OPEN"),
      membership("old", "C_OLD", { archived_at: "2026-01-01" }),
      membership("off", "C_OFF", { bridge_disabled: true }),
      membership("hub-only", null),
      membership("unread", "C_UNREAD"),
    ];
    info.mockResolvedValue({ ok: true, channel: { last_read: "0000000000.000000" } });
    await pullReadFromSlack(service, "member-fern", { exceptChannelId: "open" });
    expect(info.mock.calls.map((c) => (c[0] as { channel: string }).channel)).toEqual(["C_UNREAD"]);
    expect(rpc).not.toHaveBeenCalledWith("chat_apply_slack_read", expect.anything());
  });

  it("asks Slack about nothing when it can't read which conversations the member is in", async () => {
    memberships = [membership("chan-1", "C_ONE")];
    failing = ["slackReadTargets"];
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(true);
    expect(info).not.toHaveBeenCalled();
  });

  it("asks Slack only about conversations with unread in the Hub, newest first", async () => {
    memberships = [membership("quiet", "C_QUIET"), membership("older", "C_OLDER"), membership("newest", "C_NEWEST")];
    unread = { data: [{ channel_id: "newest" }, { channel_id: "older" }], error: null };
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("chat_unread_channel_ids", { p_member: "member-fern" });
    expect(info.mock.calls.map((c) => (c[0] as { channel: string }).channel)).toEqual(["C_NEWEST", "C_OLDER"]);
  });

  it("makes no Slack call at all when nothing is unread in the Hub", async () => {
    memberships = [membership("quiet", "C_QUIET")];
    unread = { data: [], error: null };
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(true);
    expect(info).not.toHaveBeenCalled();
  });

  it("falls back to every conversation when the unread list can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    memberships = [membership("chan-1", "C_ONE"), membership("chan-2", "C_TWO")];
    unread = { data: null, error: { message: "boom" } };
    await pullReadFromSlack(service, "member-fern");
    expect(info).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("chat_unread_channel_ids failed"), "member-fern", "boom");
  });

  it("says when it stopped at a missing scope or a rate limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    memberships = [membership("chan-1", "C_ONE")];
    info.mockRejectedValueOnce({ data: { error: "missing_scope" } });
    await pullReadFromSlack(service, "member-fern");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stopped"), "member-fern", "missing_scope");

    info.mockRejectedValueOnce({ code: "slack_webapi_rate_limited_error" });
    await pullReadFromSlack(service, "member-fern");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stopped"), "member-fern", "rate limited");
  });

  it("does nothing when a pull ran recently or the member hasn't connected Slack", async () => {
    memberships = [membership("chan-1", "C_ONE")];
    claim = false;
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(false);
    claim = true;
    getSlackUserToken.mockResolvedValue(null);
    await expect(pullReadFromSlack(service, "member-fern")).resolves.toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it("stops at a missing scope or a dead token, and carries on past a conversation they aren't in", async () => {
    memberships = [membership("chan-1", "C_ONE"), membership("chan-2", "C_TWO")];
    info.mockRejectedValueOnce({ data: { error: "channel_not_found" } }).mockResolvedValueOnce({ ok: true, channel: { last_read: "1700000000.000100" } });
    await pullReadFromSlack(service, "member-fern");
    expect(rpc).toHaveBeenCalledWith("chat_apply_slack_read", expect.objectContaining({ p_channel_id: "chan-2" }));

    info.mockReset();
    info.mockRejectedValue({ data: { error: "token_revoked" } });
    await pullReadFromSlack(service, "member-fern");
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
  });
});
