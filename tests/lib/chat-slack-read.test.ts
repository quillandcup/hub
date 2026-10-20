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

let channel: Record<string, unknown> | null;
let newest: Record<string, unknown> | null;
let memberships: unknown[];
let claim: boolean;
const rpc = vi.fn();

const service = {
  rpc: (name: string, args: unknown) => rpc(name, args),
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "lte", "order", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: table === "chat_channels" ? channel : newest });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: memberships });
    return chain;
  },
} as never;

const membership = (channelId: string, slackChannelId: string | null, extra: Record<string, unknown> = {}) => ({
  channel_id: channelId,
  chat_channels: { slack_channel_id: slackChannelId, archived_at: null, bridge_disabled: false, ...extra },
});

beforeEach(() => {
  config.isProduction = true;
  channel = { slack_channel_id: "C_HOSTS" };
  newest = { slack_ts: "1700000000.000200" };
  memberships = [];
  claim = true;
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  info.mockReset();
  info.mockResolvedValue({ ok: true, channel: { last_read: "1700000000.000100" } });
  mark.mockReset();
  mark.mockResolvedValue({ ok: true });
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => (name === "chat_claim_slack_read_pull" ? { data: claim } : { data: null, error: null }));
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
