import { beforeEach, describe, expect, it, vi } from "vitest";

const slack = vi.hoisted(() => ({
  auth: { test: vi.fn() },
  conversations: { open: vi.fn() },
  chat: { postMessage: vi.fn() },
  users: { getPresence: vi.fn() },
}));
const getCurrentUser = vi.hoisted(() => vi.fn());
const getEffectiveIdentity = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
const matchSlackUsersToMembers = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({ data: {} as Record<string, unknown[]> }));

vi.mock("@slack/web-api", () => ({ WebClient: vi.fn(function () { return slack; }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity }));
vi.mock("@/lib/slack-matching", () => ({ matchSlackUsersToMembers, loadVerifiedSlackLinks: async () => new Map() }));
vi.mock("@/lib/wheel-of-wonder-starters", () => ({ pickConversationStarter: () => "a starter" }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: (_name: string, fn: () => unknown) => fn(),
  actionOutcome: () => ({ ok: true }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ insert }) }),
}));

/** A chainable, awaitable query whose result is the rows registered for its table. */
function query(table: string) {
  const chain: Record<string, unknown> = {};
  const result = { data: tables.data[table] ?? [] };
  for (const method of ["select", "eq", "neq", "gte", "range"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return chain;
}
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => query(table),
    schema: () => ({ from: (table: string) => query(table) }),
  }),
}));

// Attendance goes through its repository (lib/data/); this test has none, so it gets the in-memory twin.
vi.mock("@/lib/data/repos", async () => {
  const { InMemoryAttendanceRepository } = await import("@/lib/data/attendance");
  return { createRepos: () => ({ attendance: new InMemoryAttendanceRepository() }) };
});

import { introduceOnSlack, spinWheel } from "@/app/(member)/wheel-of-wonder/actions";

describe("Wheel of Wonder actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    getCurrentUser.mockResolvedValue({ id: "u1", email: "viewer@example.com" });
    getEffectiveIdentity.mockResolvedValue({ memberId: "mbr_viewer", memberName: "Ada Example" });
    tables.data = {
      members: [{ id: "mbr_winner", name: "Fern Example", photo_url: null }],
    };
    matchSlackUsersToMembers.mockResolvedValue(
      new Map([
        ["U_VIEWER", "mbr_viewer"],
        ["U_WINNER", "mbr_winner"],
      ])
    );
    slack.auth.test.mockResolvedValue({ team_id: "T1" });
    slack.conversations.open.mockResolvedValue({ channel: { id: "C1" } });
    slack.chat.postMessage.mockResolvedValue({});
    slack.users.getPresence.mockResolvedValue({ presence: "active" });
    insert.mockResolvedValue({ error: null });
  });

  describe("spinWheel", () => {
    it("picks a match without opening a room or posting anything", async () => {
      const result = await spinWheel();

      expect(result).toMatchObject({ winner: { memberId: "mbr_winner", memberName: "Fern Example" } });
      expect(slack.conversations.open).not.toHaveBeenCalled();
      expect(slack.chat.postMessage).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it("reports no one available when nobody is active on Slack", async () => {
      slack.users.getPresence.mockResolvedValue({ presence: "away" });

      expect(await spinWheel()).toEqual({ noOneAvailable: true });
    });

    it("rejects signed-out and member-less callers", async () => {
      getCurrentUser.mockResolvedValueOnce(null);
      expect(await spinWheel()).toEqual({ error: "Not authenticated" });
      getEffectiveIdentity.mockResolvedValueOnce(null);
      expect(await spinWheel()).toEqual({ error: "No member record" });
    });
  });

  describe("introduceOnSlack", () => {
    it("opens the room, posts the icebreaker and records the match", async () => {
      const result = await introduceOnSlack("mbr_winner");

      expect(result).toEqual({ url: "slack://channel?team=T1&id=C1", roomCreated: true, starterText: null });
      expect(slack.conversations.open).toHaveBeenCalledWith({ users: "U_VIEWER,U_WINNER" });
      expect(slack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C1", unfurl_links: false, unfurl_media: false })
      );
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ spinner_member_id: "mbr_viewer", matched_member_id: "mbr_winner", status: "proposed" })
      );
    });

    it("still sends the member to the room when the tracking insert fails", async () => {
      insert.mockResolvedValue({ error: new Error("db down") });
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await introduceOnSlack("mbr_winner")).toMatchObject({ url: "slack://channel?team=T1&id=C1", roomCreated: true });
    });

    it("falls back to the 1:1 DM and a copyable icebreaker when the room fails", async () => {
      slack.conversations.open.mockRejectedValue(new Error("missing_scope"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await introduceOnSlack("mbr_winner")).toEqual({
        url: "slack://user?team=T1&id=U_WINNER",
        roomCreated: false,
        starterText: "a starter",
      });
      expect(slack.chat.postMessage).not.toHaveBeenCalled();
    });

    it("falls back when the room has no channel id", async () => {
      slack.conversations.open.mockResolvedValue({});
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await introduceOnSlack("mbr_winner")).toMatchObject({ roomCreated: false });
    });

    it("uses the workspace URL when the team id can't be resolved", async () => {
      slack.auth.test.mockRejectedValue(new Error("nope"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await introduceOnSlack("mbr_winner");

      expect(result).toMatchObject({ url: "https://quillandcup.slack.com", roomCreated: false });
      expect(slack.conversations.open).not.toHaveBeenCalled();
    });

    it("refuses a member who isn't in the pool or has no Slack account", async () => {
      expect(await introduceOnSlack("mbr_stranger")).toEqual({ error: "Couldn't find that member on Slack" });
      expect(slack.conversations.open).not.toHaveBeenCalled();
    });

    it("rejects signed-out callers, member-less callers and missing Slack config", async () => {
      getCurrentUser.mockResolvedValueOnce(null);
      expect(await introduceOnSlack("mbr_winner")).toEqual({ error: "Not authenticated" });
      getEffectiveIdentity.mockResolvedValueOnce(null);
      expect(await introduceOnSlack("mbr_winner")).toEqual({ error: "No member record" });
      delete process.env.SLACK_BOT_TOKEN;
      expect(await introduceOnSlack("mbr_winner")).toEqual({ error: "Slack isn't configured for this workspace yet" });
    });
  });
});
