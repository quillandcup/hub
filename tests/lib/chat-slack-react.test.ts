import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { add, remove, config, getSlackUserToken } = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return { reactions: { add: (a: unknown) => add(a, token), remove: (a: unknown) => remove(a, token) } };
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

import { syncReactionToSlack } from "@/lib/chat/slack-react";

const OPTS = { messageId: "m1", memberId: "member-fern", emoji: "tada", active: true };
let message: Record<string, unknown> | null;
const rpc = vi.fn(async () => ({ error: null }));
const reactionUpdates: { values: unknown; filters: unknown[][] }[] = [];

const service = {
  rpc,
  from: (table: string) => {
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) chain[m] = (...args: unknown[]) => (filters.push([m, ...args]), chain);
    chain.maybeSingle = async () => ({ data: table === "chat_messages" ? message : null });
    chain.update = (values: unknown) => {
      // The reaction update is awaited after its last filter, so make the chain thenable.
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        reactionUpdates.push({ values, filters });
        resolve({ error: null });
      };
      return chain;
    };
    return chain;
  },
} as never;

beforeEach(() => {
  config.isProduction = true;
  message = { slack_ts: "1700000000.000100", chat_channels: { slack_channel_id: "C_HOSTS" } };
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  add.mockReset();
  add.mockResolvedValue({ ok: true });
  remove.mockReset();
  remove.mockResolvedValue({ ok: true });
  rpc.mockClear();
  reactionUpdates.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("syncReactionToSlack", () => {
  it("adds the reaction in Slack as the member and marks it synced", async () => {
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith({ channel: "C_HOSTS", timestamp: "1700000000.000100", name: "tada" }, "xoxp-fern");
    expect(remove).not.toHaveBeenCalled();
    expect(reactionUpdates).toHaveLength(1);
    expect(reactionUpdates[0].values).toEqual({ synced_to_slack: true });
    expect(reactionUpdates[0].filters).toContainEqual(["eq", "member_id", "member-fern"]);
    expect(reactionUpdates[0].filters).toContainEqual(["is", "slack_user_id", null]);
  });

  it("takes it back in Slack when the Hub reaction was removed", async () => {
    await expect(syncReactionToSlack(service, { ...OPTS, active: false })).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ channel: "C_HOSTS", timestamp: "1700000000.000100", name: "tada" }, "xoxp-fern");
    expect(add).not.toHaveBeenCalled();
  });

  it("counts Slack already agreeing as synced", async () => {
    add.mockRejectedValueOnce({ data: { error: "already_reacted" } });
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(true);
    remove.mockRejectedValueOnce({ data: { error: "no_reaction" } });
    await expect(syncReactionToSlack(service, { ...OPTS, active: false })).resolves.toBe(true);
  });

  it("does nothing for a member who hasn't connected Slack, off production, or for a message not in Slack", async () => {
    getSlackUserToken.mockResolvedValueOnce(null);
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);

    config.isProduction = false;
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    config.isProduction = true;

    message = { slack_ts: null, chat_channels: { slack_channel_id: "C_HOSTS" } };
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(reactionUpdates).toHaveLength(0);
  });

  it("revokes the connection on a dead token, and just logs any other failure; either way it stays Hub-only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    add.mockRejectedValueOnce({ data: { error: "token_revoked" } });
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });

    rpc.mockClear();
    add.mockRejectedValueOnce({ data: { error: "invalid_name" } });
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(reactionUpdates).toHaveLength(0);
  });
});
