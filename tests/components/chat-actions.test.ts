import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const slackRead = vi.hoisted(() => ({
  after: [] as (() => unknown)[],
  push: vi.fn(async () => true),
  pull: vi.fn(async () => true),
}));
vi.mock("next/server", () => ({ after: (cb: () => unknown) => void slackRead.after.push(cb) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/chat/slack-read", () => ({ pushReadToSlack: slackRead.push, pullReadFromSlack: slackRead.pull }));
let chatOn = true;
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: async () => chatOn,
}));

const { markChatRead, syncChatReadFromSlack } = await import("@/app/(member)/chat/actions");

const CHANNEL = "00000000-0000-4000-a000-000000000001";
let fake: FakeSupabase;
const calls = () => fake.queries.filter((q) => q.table === "rpc:chat_mark_read");

beforeEach(() => {
  resetServerPageMocks();
  chatOn = true;
  slackRead.after.length = 0;
  slackRead.push.mockClear();
  slackRead.pull.mockReset();
  slackRead.pull.mockResolvedValue(true);
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  fake = useFakeSupabase({ "rpc:chat_mark_read": () => ({ data: null }) });
});

describe("markChatRead", () => {
  it("passes the message's created_at on untouched, microseconds and all", async () => {
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    expect(calls()).toHaveLength(1);
    expect(calls()[0].calls[0].args[0]).toEqual({ p_channel_id: CHANNEL, p_through: "2026-10-10T16:51:47.013065+00:00" });
  });

  it("does nothing for a bad channel id or time, signed out, in sudo, or with chat off", async () => {
    await markChatRead("nope", "2026-10-10T16:51:47.013065+00:00");
    await markChatRead(CHANNEL, "not a time");
    signInAs(null);
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    chatOn = false;
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    expect(calls()).toHaveLength(0);
  });
});

describe("markChatRead and Slack", () => {
  it("moves the member's Slack marker too, after the response", async () => {
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    expect(slackRead.push).not.toHaveBeenCalled();
    await slackRead.after[0]();
    expect(slackRead.push).toHaveBeenCalledWith({ service: true }, {
      memberId: MEMBER_IDENTITY.memberId,
      channelId: CHANNEL,
      through: "2026-10-10T16:51:47.013065+00:00",
    });
  });

  it("leaves Slack alone when the Hub marker did not move", async () => {
    fake = useFakeSupabase({ "rpc:chat_mark_read": () => ({ data: null, error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await markChatRead(CHANNEL, "2026-10-10T16:51:47.013065+00:00");
    expect(slackRead.after).toHaveLength(0);
  });
});

describe("syncChatReadFromSlack", () => {
  beforeEach(() => {
    fake = useFakeSupabase({ "rpc:chat_unread_counts": () => ({ data: [{ channel_id: CHANNEL, unread: 3 }] }) });
  });

  it("pulls Slack's markers, sparing the open conversation, and answers with the fresh counts", async () => {
    await expect(syncChatReadFromSlack(CHANNEL)).resolves.toEqual({ [CHANNEL]: 3 });
    expect(slackRead.pull).toHaveBeenCalledWith({ service: true }, MEMBER_IDENTITY.memberId, { exceptChannelId: CHANNEL });
  });

  it("ignores an open-conversation id that isn't one", async () => {
    await syncChatReadFromSlack("nope");
    expect(slackRead.pull).toHaveBeenCalledWith({ service: true }, MEMBER_IDENTITY.memberId, { exceptChannelId: null });
  });

  it("answers null when nothing was pulled, and never pulls in sudo, signed out or with chat off", async () => {
    slackRead.pull.mockResolvedValue(false);
    await expect(syncChatReadFromSlack(null)).resolves.toBeNull();
    slackRead.pull.mockClear();
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await expect(syncChatReadFromSlack(null)).resolves.toBeNull();
    signInAs(null);
    await expect(syncChatReadFromSlack(null)).resolves.toBeNull();
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    chatOn = false;
    await expect(syncChatReadFromSlack(null)).resolves.toBeNull();
    expect(slackRead.pull).not.toHaveBeenCalled();
  });
});
