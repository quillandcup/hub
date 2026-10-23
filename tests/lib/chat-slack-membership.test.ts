import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { writesEnabled } = vi.hoisted(() => ({ writesEnabled: vi.fn(() => true) }));
vi.mock("@/lib/chat/slack-post", () => ({ chatSlackWritesEnabled: () => writesEnabled() }));
vi.mock("@slack/web-api", () => ({ WebClient: vi.fn() }));

import { inviteToSlackChannel, kickFromSlackChannel, leaveSlackChannelAsMember, slackUserIdsFor } from "@/lib/chat/slack-membership";

const stub = () => {
  const slack = {
    conversations: {
      invite: vi.fn(async () => ({ ok: true })),
      kick: vi.fn(async () => ({ ok: true })),
      leave: vi.fn(async () => ({ ok: true })),
      info: vi.fn(async () => ({ ok: true, channel: { is_member: true } })),
    },
  };
  return slack as typeof slack & import("@slack/web-api").WebClient;
};
const fail = (code: string) => Object.assign(new Error(code), { data: { error: code } });

beforeEach(() => {
  writesEnabled.mockReset();
  writesEnabled.mockReturnValue(true);
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("slackUserIdsFor", () => {
  const service = (rows: { slack_user_id: string; member_id: string }[]) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.in = () => Promise.resolve({ data: rows });
    return { from: () => chain } as never;
  };

  it("maps each member to their Slack account, the first one when there are several", async () => {
    const ids = await slackUserIdsFor(
      service([
        { slack_user_id: "U_FERN", member_id: "m-fern" },
        { slack_user_id: "U_FERN2", member_id: "m-fern" },
        { slack_user_id: "U_GALE", member_id: "m-gale" },
      ]),
      ["m-fern", "m-gale", "m-hazel"]
    );
    expect([...ids]).toEqual([["m-fern", "U_FERN"], ["m-gale", "U_GALE"]]);
  });

  it("asks nothing for nobody", async () => {
    const from = vi.fn();
    expect((await slackUserIdsFor({ from } as never, [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("inviteToSlackChannel", () => {
  it("invites everyone in one call", async () => {
    const slack = stub();
    await expect(inviteToSlackChannel({ channel: "C1", userIds: ["U1", "U2"], slack })).resolves.toEqual({ ok: true });
    expect(slack.conversations.invite).toHaveBeenCalledWith({ channel: "C1", users: "U1,U2" });
  });

  it("calls nothing for nobody", async () => {
    const slack = stub();
    await expect(inviteToSlackChannel({ channel: "C1", userIds: [], slack })).resolves.toEqual({ ok: true });
    expect(slack.conversations.invite).not.toHaveBeenCalled();
  });

  it("counts someone already in it as done", async () => {
    const slack = stub();
    slack.conversations.invite.mockRejectedValue(fail("already_in_channel"));
    await expect(inviteToSlackChannel({ channel: "C1", userIds: ["U1"], slack })).resolves.toEqual({ ok: true });
  });

  it.each([
    ["not_in_channel", "Billie Bot isn't in this conversation"],
    ["channel_not_found", "can't find this conversation"],
    ["is_archived", "archived in Slack"],
    ["user_is_restricted", "a guest"],
    ["cant_invite", "won't let the people be added"],
    ["user_not_found", "doesn't know one of those people"],
    ["missing_scope", "needs a new permission"],
    ["something_else", "Try again in a moment"],
  ])("says what Slack's %s means", async (code, words) => {
    const slack = stub();
    slack.conversations.invite.mockRejectedValue(fail(code));
    await expect(inviteToSlackChannel({ channel: "C1", userIds: ["U1"], slack })).resolves.toEqual({ ok: false, error: expect.stringContaining(words) });
  });

  it("won't touch Slack off production, or without a bot token", async () => {
    const slack = stub();
    writesEnabled.mockReturnValue(false);
    await expect(inviteToSlackChannel({ channel: "C1", userIds: ["U1"], slack })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("live Hub") });
    writesEnabled.mockReturnValue(true);
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    await expect(inviteToSlackChannel({ channel: "C1", userIds: ["U1"] })).resolves.toEqual({ ok: false, error: "Slack isn't set up to do that." });
    expect(slack.conversations.invite).not.toHaveBeenCalled();
  });
});

describe("kickFromSlackChannel", () => {
  it("removes the person", async () => {
    const slack = stub();
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toEqual({ ok: true });
    expect(slack.conversations.kick).toHaveBeenCalledWith({ channel: "C1", user: "U1" });
  });

  it("counts someone who wasn't in it as done, when it is the bot that is in it", async () => {
    const slack = stub();
    slack.conversations.kick.mockRejectedValue(fail("not_in_channel"));
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toEqual({ ok: true });
    expect(slack.conversations.info).toHaveBeenCalledWith({ channel: "C1" });
  });

  it("says nothing was removed when it is the bot that isn't in the conversation, or that can't be told", async () => {
    const slack = stub();
    slack.conversations.kick.mockRejectedValue(fail("not_in_channel"));
    slack.conversations.info.mockResolvedValue({ ok: true, channel: { is_member: false } } as never);
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toEqual({ ok: false, error: expect.stringContaining("Billie Bot isn't in this conversation") });

    slack.conversations.info.mockRejectedValue(fail("channel_not_found"));
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["cant_kick_from_general", "default channel"],
    ["restricted_action", "limits who can remove people"],
    ["cant_kick_self", "won't let that person be removed"],
    ["no_permission", "won't let that person be removed"],
    ["channel_not_found", "can't find this conversation"],
    ["missing_scope", "needs a new permission"],
    ["something_else", "Try again in a moment"],
  ])("says what Slack's %s means", async (code, words) => {
    const slack = stub();
    slack.conversations.kick.mockRejectedValue(fail(code));
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toEqual({ ok: false, error: expect.stringContaining(words) });
  });

  it("won't touch Slack off production, or without a bot token", async () => {
    const slack = stub();
    writesEnabled.mockReturnValue(false);
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1", slack })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("live Hub") });
    writesEnabled.mockReturnValue(true);
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    await expect(kickFromSlackChannel({ channel: "C1", userId: "U1" })).resolves.toEqual({ ok: false, error: "Slack isn't set up to do that." });
    expect(slack.conversations.kick).not.toHaveBeenCalled();
  });
});

describe("leaveSlackChannelAsMember", () => {
  it("leaves as the member", async () => {
    const slack = stub();
    await expect(leaveSlackChannelAsMember({ channel: "C1", token: "xoxp", slack })).resolves.toEqual({ ok: true });
    expect(slack.conversations.leave).toHaveBeenCalledWith({ channel: "C1" });
  });

  it("counts not being in it as done", async () => {
    const slack = stub();
    slack.conversations.leave.mockRejectedValue(fail("not_in_channel"));
    await expect(leaveSlackChannelAsMember({ channel: "C1", token: "xoxp", slack })).resolves.toEqual({ ok: true });
  });

  it.each(["token_revoked", "invalid_auth", "missing_scope"])("asks the caller to use the bot when the token fails with %s", async (code) => {
    const slack = stub();
    slack.conversations.leave.mockRejectedValue(fail(code));
    await expect(leaveSlackChannelAsMember({ channel: "C1", token: "xoxp", slack })).resolves.toMatchObject({ ok: false, retryWithBot: true });
  });

  it.each([
    ["channel_not_found", "can't find this conversation"],
    ["is_archived", "archived"],
    ["cant_leave_general", "default channel"],
    ["something_else", "Try again in a moment"],
  ])("says what %s means, without falling back", async (code, words) => {
    const slack = stub();
    slack.conversations.leave.mockRejectedValue(fail(code));
    const result = await leaveSlackChannelAsMember({ channel: "C1", token: "xoxp", slack });
    expect(result).toEqual({ ok: false, error: expect.stringContaining(words) });
    expect(result).not.toHaveProperty("retryWithBot");
  });

  it("won't touch Slack off production", async () => {
    const slack = stub();
    writesEnabled.mockReturnValue(false);
    await expect(leaveSlackChannelAsMember({ channel: "C1", token: "xoxp", slack })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("live Hub") });
    expect(slack.conversations.leave).not.toHaveBeenCalled();
  });
});
