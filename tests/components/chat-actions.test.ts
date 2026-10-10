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
let chatOn = true;
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: async () => chatOn,
}));

const { markChatRead } = await import("@/app/(member)/chat/actions");

const CHANNEL = "00000000-0000-4000-a000-000000000001";
let fake: FakeSupabase;
const calls = () => fake.queries.filter((q) => q.table === "rpc:chat_mark_read");

beforeEach(() => {
  resetServerPageMocks();
  chatOn = true;
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
