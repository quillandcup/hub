import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import { ADMIN_USER, MEMBER_USER, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// What withAction records is tested in analytics-server.test.ts; here the action just runs.
vi.mock("@/lib/analytics/server", () => ({
  withAction: vi.fn(async (_action: string, run: () => Promise<unknown>) => run()),
}));
const preview = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/staff-preview.server", () => ({ getStaffPreviewRole: async () => preview.role }));

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";

let data: InMemoryDataset;
let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { revalidatePath } from "next/cache";
import {
  closeConversation,
  deleteConversation,
  logConversationMessage,
  searchConversationMembers,
  startConversation,
  updateConversation,
} from "@/app/(admin)/admin/conversations/actions";

const start = (over: Record<string, unknown> = {}) => startConversation({ memberId: ADA, reason: "writing_check_in", channel: "slack_dm", ...over });
const onlyConversation = () => {
  expect(data.conversations).toHaveLength(1);
  return data.conversations[0];
};

beforeEach(() => {
  resetServerPageMocks();
  preview.role = null;
  vi.mocked(revalidatePath).mockClear();
  data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
      { id: BO, name: "Bo Example", email: "bo@example.test" },
    ],
    userProfiles: [
      { id: ADMIN_USER.id, email: ADMIN_USER.email!, role: "admin" },
      { id: MEMBER_USER.id, email: MEMBER_USER.email!, role: "member" },
      { id: CM_USER.id, email: CM_USER.email, role: "community_manager" },
    ],
  });
  repos = createInMemoryRepos(data);
});

describe("who may write conversations", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["startConversation", () => start()],
    ["logConversationMessage", () => logConversationMessage("conv_AAAAAAAAAAA1", "member")],
    ["updateConversation", () => updateConversation("conv_AAAAAAAAAAA1", { notes: "x" })],
    ["closeConversation", () => closeConversation("conv_AAAAAAAAAAA1", "resolved")],
    ["deleteConversation", () => deleteConversation("conv_AAAAAAAAAAA1")],
  ];

  it.each(calls)("%s refuses a signed-out caller", async (_name, call) => {
    signInAs(null);
    await expect(call()).resolves.toEqual({ error: "Not authenticated" });
    expect(data.conversations).toEqual([]);
  });

  it.each(calls)("%s refuses a plain member called directly", async (_name, call) => {
    signInAs(MEMBER_USER);
    await expect(call()).resolves.toEqual({ error: "Not authorized" });
    expect(data.conversations).toEqual([]);
  });

  it("lets a community manager start one, as herself", async () => {
    signInAs(CM_USER);
    await expect(start({ notes: "  said hello  " })).resolves.toEqual({ success: true });
    expect(onlyConversation()).toMatchObject({ member_id: ADA, opened_by: CM_USER.id, reason: "writing_check_in", channel: "slack_dm", notes: "said hello" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/conversations");
  });

  it("lets an admin start one", async () => {
    signInAs(ADMIN_USER);
    await expect(start()).resolves.toEqual({ success: true });
    expect(onlyConversation().opened_by).toBe(ADMIN_USER.id);
  });

  it("treats an admin previewing the community manager as that role, which may write", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER);
    await expect(start()).resolves.toEqual({ success: true });
  });

  describe("a staff role without the write feature", () => {
    const granted = [...COMMUNITY_MANAGER_FEATURES];
    beforeEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).splice(0));
    afterEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).push(...granted));

    it.each(calls)("%s is refused", async (_name, call) => {
      signInAs(CM_USER);
      await expect(call()).resolves.toEqual({ error: "Not authorized" });
      expect(data.conversations).toEqual([]);
    });

    it("finds no one for the picker", async () => {
      signInAs(CM_USER);
      await expect(searchConversationMembers("ada")).resolves.toEqual([]);
    });
  });
});

describe("startConversation", () => {
  beforeEach(() => signInAs(CM_USER));

  it("starts with her message, or with theirs when they wrote first", async () => {
    await start();
    expect(onlyConversation()).toMatchObject({ last_member_message_at: null });
    expect(onlyConversation().last_staff_message_at).not.toBeNull();

    data.conversations = [];
    await start({ memberWroteFirst: true });
    expect(onlyConversation().last_staff_message_at).toBeNull();
    expect(onlyConversation().last_member_message_at).not.toBeNull();
  });

  it("writes the opening to the member's timeline as staff, with nothing she typed", async () => {
    await start({ notes: "private words", nextStep: "other private words" });

    const row = data.activities.find((a) => a.source === "conversations");
    expect(row).toMatchObject({
      member_id: ADA,
      activity_type: "conversation_opened",
      actor_kind: "staff",
      actor_user_id: CM_USER.id,
      engagement_value: 0,
      related_id: onlyConversation().id,
      description: "A writing check-in · Slack DM",
    });
    expect(JSON.stringify(row)).not.toContain("private words");
  });

  it("refuses a second open conversation on the same channel, and starts one on another", async () => {
    await start();
    const second = await start({ reason: "hello" });
    expect(second).toEqual({ error: expect.stringContaining("already an open conversation") });
    expect(data.conversations).toHaveLength(1);
    expect(data.activities.filter((a) => a.source === "conversations")).toHaveLength(1);

    await expect(start({ channel: "email" })).resolves.toEqual({ success: true });
    expect(data.conversations).toHaveLength(2);
  });

  it("checks what it is given", async () => {
    await expect(start({ memberId: "not-an-id" })).resolves.toEqual({ error: "Pick a member." });
    await expect(start({ reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
    await expect(start({ channel: "fax" })).resolves.toEqual({ error: "Pick where the conversation is." });
    await expect(start({ notes: "x".repeat(1001) })).resolves.toEqual({ error: "The note can be at most 1000 characters." });
    await expect(start({ nextStep: "x".repeat(281) })).resolves.toEqual({ error: "The next step can be at most 280 characters." });
    await expect(start({ notes: 42 })).resolves.toEqual({ error: "Check the note." });
    await expect(start({ followUpOn: "next week" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    await expect(start({ followUpOn: "2026-02-30" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    expect(data.conversations).toEqual([]);
  });

  it("keeps a follow-up day and treats empty text as none", async () => {
    await start({ followUpOn: "2026-03-08", notes: "   ", nextStep: "" });
    expect(onlyConversation()).toMatchObject({ follow_up_on: "2026-03-08", notes: null, next_step: null });
  });

  it("says it could not start when the database fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.conversations, "open").mockRejectedValueOnce(new Error("connection reset"));
    await expect(start()).resolves.toEqual({ error: "Couldn't start the conversation." });
  });

  it("still starts when the timeline mirror fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "record").mockRejectedValueOnce(new Error("timeline down"));
    await expect(start()).resolves.toEqual({ success: true });
    expect(data.conversations).toHaveLength(1);
  });
});

describe("the rest of a conversation's life", () => {
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    await start();
    id = onlyConversation().id;
  });

  it("logs that they replied, and that she did", async () => {
    await expect(logConversationMessage(id, "member")).resolves.toEqual({ success: true });
    expect(onlyConversation().last_member_message_at).not.toBeNull();
    await expect(logConversationMessage(id, "staff")).resolves.toEqual({ success: true });
    await expect(logConversationMessage(id, "robot")).resolves.toEqual({ error: "That conversation is gone." });
    await expect(logConversationMessage("nope", "member")).resolves.toEqual({ error: "That conversation is gone." });
  });

  it("will not log into a closed conversation", async () => {
    await closeConversation(id, "resolved");
    await expect(logConversationMessage(id, "member")).resolves.toEqual({ error: "That conversation is closed or gone." });
  });

  it("updates the reason, notes, next step and follow-up day, and clears with empty text", async () => {
    await expect(updateConversation(id, { reason: "encouragement", notes: "n", nextStep: "s", followUpOn: "2026-04-01" })).resolves.toEqual({ success: true });
    expect(onlyConversation()).toMatchObject({ reason: "encouragement", notes: "n", next_step: "s", follow_up_on: "2026-04-01" });

    await updateConversation(id, { notes: "", nextStep: null, followUpOn: "" });
    expect(onlyConversation()).toMatchObject({ notes: null, next_step: null, follow_up_on: null, reason: "encouragement" });
  });

  it("checks an update", async () => {
    await expect(updateConversation("nope", {})).resolves.toEqual({ error: "That conversation is gone." });
    await expect(updateConversation(id, { reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
    await expect(updateConversation(id, { notes: "x".repeat(1001) })).resolves.toEqual({ error: "The note can be at most 1000 characters." });
    await expect(updateConversation(id, { nextStep: "x".repeat(281) })).resolves.toEqual({ error: "The next step can be at most 280 characters." });
    await expect(updateConversation(id, { followUpOn: "tomorrow" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    await expect(updateConversation("conv_ZZZZZZZZZZZZ", { notes: "x" })).resolves.toEqual({ error: "That conversation is gone." });
  });

  it("closes with an outcome, once, and puts it on the member's timeline", async () => {
    await expect(closeConversation(id, "re_engaged")).resolves.toEqual({ success: true });
    expect(onlyConversation()).toMatchObject({ outcome: "re_engaged" });
    expect(onlyConversation().closed_at).not.toBeNull();

    const closing = data.activities.filter((a) => a.source === "conversations" && a.activity_type === "conversation_closed");
    expect(closing).toHaveLength(1);
    expect(closing[0]).toMatchObject({ member_id: ADA, actor_kind: "staff", engagement_value: 0, description: "A writing check-in · Slack DM: Came back" });

    await expect(closeConversation(id, "resolved")).resolves.toEqual({ error: "That conversation is already closed or gone." });
    expect(data.activities.filter((a) => a.activity_type === "conversation_closed")).toHaveLength(1);
  });

  it("refuses a close without a real outcome", async () => {
    await expect(closeConversation(id, "vanished")).resolves.toEqual({ error: "Pick how it ended." });
    await expect(closeConversation("nope", "resolved")).resolves.toEqual({ error: "That conversation is gone." });
    expect(onlyConversation().closed_at).toBeNull();
  });

  it("removes a conversation from the list", async () => {
    await expect(deleteConversation(id)).resolves.toEqual({ success: true });
    expect(onlyConversation().deleted_at).not.toBeNull();
    await expect(deleteConversation(id)).resolves.toEqual({ error: "That conversation is gone." });
    await expect(deleteConversation("nope")).resolves.toEqual({ error: "That conversation is gone." });
  });

  it.each([
    ["logConversationMessage", "logMessage", () => logConversationMessage(id, "member"), "Couldn't save that."],
    ["updateConversation", "update", () => updateConversation(id, { notes: "x" }), "Couldn't save the change."],
    ["closeConversation", "close", () => closeConversation(id, "resolved"), "Couldn't close the conversation."],
    ["deleteConversation", "softDelete", () => deleteConversation(id), "Couldn't remove the conversation."],
  ] as const)("%s says so when the database fails, without its message", async (_name, method, call, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.conversations, method).mockRejectedValueOnce(new Error("connection reset"));
    await expect(call()).resolves.toEqual({ error: message });
  });
});

describe("searchConversationMembers", () => {
  it("finds members by name for the picker, display name first", async () => {
    signInAs(CM_USER);
    await expect(searchConversationMembers("  ada ")).resolves.toEqual([{ id: ADA, name: "Ada E.", detail: "Ada Example · ada@example.test" }]);
  });

  it("finds no one for an empty search, a plain member or a signed-out caller", async () => {
    signInAs(CM_USER);
    await expect(searchConversationMembers("   ")).resolves.toEqual([]);
    signInAs(MEMBER_USER);
    await expect(searchConversationMembers("ada")).resolves.toEqual([]);
    signInAs(null);
    await expect(searchConversationMembers("ada")).resolves.toEqual([]);
  });
});
