import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const { add, remove, config, getSlackUserToken, repos } = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
  repos: { current: null as unknown },
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
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos.current,
}));

import { syncReactionToSlack } from "@/lib/chat/slack-react";

const MESSAGE_ID = "msg_AAAAAAAAAAA1";
const CHANNEL_ID = "chn_AAAAAAAAAAA1";
const OPTS = { messageId: MESSAGE_ID, memberId: "member-fern", emoji: "tada", active: true };
const rpc = vi.fn(async () => ({ error: null }));
/** Only the Slack connection helpers reach the client; the chat rows go through the repository. */
const service = { rpc } as never;

let dataset: InMemoryDataset;
const synced = (memberId: string, emoji = "tada") =>
  dataset.chatReactions.find((r) => r.member_id === memberId && r.emoji === emoji && !r.slack_user_id)?.synced_to_slack;

beforeEach(() => {
  config.isProduction = true;
  dataset = new InMemoryDataset({
    chatChannels: [{ id: CHANNEL_ID, slack_channel_id: "C_HOSTS" }],
    chatMessages: [{ id: MESSAGE_ID, channel_id: CHANNEL_ID, slack_ts: "1700000000.000100" }],
    chatReactions: [
      { message_id: MESSAGE_ID, emoji: "tada", member_id: "member-fern", synced_to_slack: false },
      { message_id: MESSAGE_ID, emoji: "tada", member_id: "member-gale", synced_to_slack: false },
      { message_id: MESSAGE_ID, emoji: "tada", member_id: null, slack_user_id: "U_SLACK", synced_to_slack: false },
    ],
  });
  repos.current = createInMemoryRepos(dataset);
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  add.mockReset();
  add.mockResolvedValue({ ok: true });
  remove.mockReset();
  remove.mockResolvedValue({ ok: true });
  rpc.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("syncReactionToSlack", () => {
  it("adds the reaction in Slack as the member and marks it synced, only that member's own", async () => {
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith({ channel: "C_HOSTS", timestamp: "1700000000.000100", name: "tada" }, "xoxp-fern");
    expect(remove).not.toHaveBeenCalled();
    expect(synced("member-fern")).toBe(true);
    expect(synced("member-gale")).toBe(false);
    expect(dataset.chatReactions.find((r) => r.slack_user_id)?.synced_to_slack).toBe(false);
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

  it("does nothing for a member who hasn't connected Slack, off production, for a message not in Slack or one that doesn't exist", async () => {
    getSlackUserToken.mockResolvedValueOnce(null);
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);

    config.isProduction = false;
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    config.isProduction = true;

    dataset.chatMessages[0].slack_ts = null;
    await expect(syncReactionToSlack(service, OPTS)).resolves.toBe(false);
    await expect(syncReactionToSlack(service, { ...OPTS, messageId: "msg_ZZZZZZZZZZZZ" })).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(synced("member-fern")).toBe(false);
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
    expect(synced("member-fern")).toBe(false);
  });
});
