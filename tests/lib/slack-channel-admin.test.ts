import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let dataset = new InMemoryDataset();
let failing = false;
const down = async () => {
  throw new Error("database is down");
};
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => (failing ? { slackWorkspace: { channelById: async () => ({ channel_id: "C_PRIVATE", name: "back-room", is_private: true, is_mpim: false }), restrictChannel: down, unrestrictChannel: down, ignoreUser: down } } : createInMemoryRepos(dataset)),
}));
const requireAdminAction = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: () => requireAdminAction() }));
const requireAdmin = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: (r: unknown) => requireAdmin(r) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const triggerReprocessing = vi.fn();
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessing(...args) }));

import { restrictSlackChannel, unrestrictSlackChannel } from "@/app/(admin)/admin/data/slack-channels/actions";
import { POST as skipSlackUser } from "@/app/api/data-hygiene/slack-users/skip/route";

beforeEach(() => {
  vi.clearAllMocks();
  failing = false;
  dataset = new InMemoryDataset({
    slackChannels: [
      { channel_id: "C_PUBLIC", name: "open-house", is_private: false },
      { channel_id: "C_PRIVATE", name: "back-room", is_private: true },
      { channel_id: "C_GROUP", name: "mpdm-fake", is_private: true, is_mpim: true },
    ],
  });
  requireAdminAction.mockResolvedValue({ ok: true, supabase: {} });
  triggerReprocessing.mockResolvedValue({ processed: [] });
});

describe("restrictSlackChannel", () => {
  it("restricts a private channel, and restricting it again is fine", async () => {
    expect(await restrictSlackChannel("C_PRIVATE")).toEqual({ success: true });
    expect(await restrictSlackChannel("C_PRIVATE")).toEqual({ success: true });
    expect(dataset.restrictedSlackChannels.map((r) => [r.channel_id, r.name])).toEqual([["C_PRIVATE", "back-room"]]);
  });

  it("refuses public channels and group DMs, and unknown channels", async () => {
    expect(await restrictSlackChannel("C_PUBLIC")).toEqual({ error: "Only private channels can be restricted" });
    expect(await restrictSlackChannel("C_GROUP")).toEqual({ error: "Only private channels can be restricted" });
    expect(await restrictSlackChannel("C_NOPE")).toEqual({ error: "Channel not found" });
    expect(dataset.restrictedSlackChannels).toEqual([]);
  });

  it("does nothing for a non-admin", async () => {
    requireAdminAction.mockResolvedValue({ ok: false, error: "Forbidden" });
    expect(await restrictSlackChannel("C_PRIVATE")).toEqual({ error: "Forbidden" });
    expect(dataset.restrictedSlackChannels).toEqual([]);
  });
});

describe("unrestrictSlackChannel", () => {
  it("lifts the restriction and rebuilds Slack activity", async () => {
    await restrictSlackChannel("C_PRIVATE");

    expect(await unrestrictSlackChannel("C_PRIVATE")).toEqual({ success: true });

    expect(dataset.restrictedSlackChannels).toEqual([]);
    expect(triggerReprocessing).toHaveBeenCalledWith("restricted_slack_channels", "local");
  });

  it("still succeeds when the rebuild reports a failure (it is logged)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    triggerReprocessing.mockResolvedValue({ processed: [{ success: false }] });

    expect(await unrestrictSlackChannel("C_PRIVATE")).toEqual({ success: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("does nothing for a non-admin", async () => {
    requireAdminAction.mockResolvedValue({ ok: false, error: "Forbidden" });
    expect(await unrestrictSlackChannel("C_PRIVATE")).toEqual({ error: "Forbidden" });
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });
});

describe("when the database is down", () => {
  beforeEach(() => {
    failing = true;
  });

  it("reports the database error from restrict and unrestrict", async () => {
    expect(await restrictSlackChannel("C_PRIVATE")).toEqual({ error: "database is down" });
    expect(await unrestrictSlackChannel("C_PRIVATE")).toEqual({ error: "database is down" });
  });

  it("fails the skip route with a 500", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "u" }, forbidden: false, supabase: {} });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await skipSlackUser(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ slack_user_id: "U_FAKE1" }) }));
    expect(response.status).toBe(500);
    log.mockRestore();
  });
});

describe("POST /api/data-hygiene/slack-users/skip", () => {
  const post = (body: unknown) =>
    skipSlackUser(new NextRequest("http://localhost/api/data-hygiene/slack-users/skip", { method: "POST", body: JSON.stringify(body) }));

  beforeEach(() => requireAdmin.mockResolvedValue({ user: { id: "u" }, forbidden: false, supabase: {} }));

  it("ignores the Slack user, as a non-member unless told otherwise, and again is fine", async () => {
    expect((await post({ slack_user_id: "U_FAKE1" })).status).toBe(200);
    expect((await post({ slack_user_id: "U_FAKE1", reason: "bot" })).status).toBe(200);
    expect((await post({ slack_user_id: "U_FAKE2", reason: "guest" })).status).toBe(200);

    expect(dataset.ignoredSlackUsers).toEqual([
      { user_id: "U_FAKE1", reason: "non_member" },
      { user_id: "U_FAKE2", reason: "guest" },
    ]);
  });

  it("rejects a missing id or an unknown reason", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ slack_user_id: "U_FAKE1", reason: "spam" })).status).toBe(400);
    expect(dataset.ignoredSlackUsers).toEqual([]);
  });

  it("turns away anonymous and non-admin callers", async () => {
    requireAdmin.mockResolvedValue({ user: null });
    expect((await post({ slack_user_id: "U_FAKE1" })).status).toBe(401);
    requireAdmin.mockResolvedValue({ user: { id: "u" }, forbidden: true });
    expect((await post({ slack_user_id: "U_FAKE1" })).status).toBe(403);
  });
});
