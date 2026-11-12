import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { periodEndsOn } from "@/lib/care";
import { CARE_ENGAGEMENT_DAYS } from "@/lib/config";
import { addDays } from "@/lib/org-week";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import { ADMIN_USER, MEMBER_USER, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { useFakeClock } from "@/tests/helpers/fake-clock";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The service-role client is only handed to createRepos, which this file replaces.
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
// What withAction records is tested in analytics-server.test.ts; here the action just runs.
vi.mock("@/lib/analytics/server", () => ({
  withAction: vi.fn(async (_action: string, run: () => Promise<unknown>) => run()),
}));
const preview = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/staff-preview.server", () => ({ getStaffPreviewRole: async () => preview.role }));

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const OWNER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // another admin
const NOT_STAFF = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // a member with a profile
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
  closeEngagement,
  deleteEngagement,
  getEngagementResults,
  logCareMessage,
  reassignEngagement,
  renewEngagement,
  searchCareMembers,
  startEngagement,
  trackCareDm,
  untrackCareDm,
  updateEngagement,
} from "@/app/(admin)/admin/care/actions";
import { SLACK_DM_SCOPES } from "@/lib/slack-connect";

const start = (over: Record<string, unknown> = {}) => startEngagement({ memberId: ADA, reason: "writing_check_in", channel: "slack_dm", ...over });
const engagementRow = (id: string, member: string, openedAt: string) => ({
  id,
  member_id: member,
  opened_by: null,
  owned_by: null,
  reason: "check_in",
  channel: "email",
  opened_at: openedAt,
  period_ends_on: "2026-12-31",
  renewed_from: null,
  closed_at: null,
  ended_how: null,
  last_staff_message_at: openedAt,
  last_member_message_at: null,
  follow_up_on: null,
  next_step: null,
  notes: null,
  deleted_at: null,
  created_at: openedAt,
  updated_at: openedAt,
});
const onlyEngagementId = () => data.careEngagements[0].id;
const onlyEngagement = () => {
  expect(data.careEngagements).toHaveLength(1);
  return data.careEngagements[0];
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
      { id: OWNER_B, email: "owner-b@example.test", role: "admin" },
      { id: NOT_STAFF, email: "plain-b@example.test", role: "member" },
    ],
  });
  repos = createInMemoryRepos(data);
});

describe("who may write Hedgie Care", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["startEngagement", () => start()],
    ["logCareMessage", () => logCareMessage("care_AAAAAAAAAAA1", "member")],
    ["updateEngagement", () => updateEngagement("care_AAAAAAAAAAA1", { notes: "x" })],
    ["closeEngagement", () => closeEngagement("care_AAAAAAAAAAA1", "no_reply")],
    ["renewEngagement", () => renewEngagement("care_AAAAAAAAAAA1", "a plan")],
    ["reassignEngagement", () => reassignEngagement("care_AAAAAAAAAAA1", OWNER_B)],
    ["getEngagementResults", () => getEngagementResults("care_AAAAAAAAAAA1")],
    ["deleteEngagement", () => deleteEngagement("care_AAAAAAAAAAA1")],
    ["trackCareDm", () => trackCareDm("D0ADA0001")],
    ["untrackCareDm", () => untrackCareDm("D0ADA0001")],
  ];

  it.each(calls)("%s refuses a signed-out caller", async (_name, call) => {
    signInAs(null);
    await expect(call()).resolves.toEqual({ error: "Not authenticated" });
    expect(data.careEngagements).toEqual([]);
  });

  it.each(calls)("%s refuses a plain member called directly", async (_name, call) => {
    signInAs(MEMBER_USER);
    await expect(call()).resolves.toEqual({ error: "Not authorized" });
    expect(data.careEngagements).toEqual([]);
  });

  it("lets a community manager start one, as herself", async () => {
    signInAs(CM_USER);
    await expect(start({ notes: "  said hello  " })).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ member_id: ADA, opened_by: CM_USER.id, reason: "writing_check_in", channel: "slack_dm", notes: "said hello" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
  });

  it("lets an admin start one", async () => {
    signInAs(ADMIN_USER);
    await expect(start()).resolves.toEqual({ success: true });
    expect(onlyEngagement().opened_by).toBe(ADMIN_USER.id);
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
      expect(data.careEngagements).toEqual([]);
    });

    it("finds no one for the picker", async () => {
      signInAs(CM_USER);
      await expect(searchCareMembers("ada")).resolves.toEqual([]);
    });
  });
});

describe("startEngagement", () => {
  beforeEach(() => signInAs(CM_USER));

  it("starts with her message, or with theirs when they wrote first", async () => {
    await start();
    expect(onlyEngagement()).toMatchObject({ last_member_message_at: null });
    expect(onlyEngagement().last_staff_message_at).not.toBeNull();

    data.careEngagements = [];
    await start({ memberWroteFirst: true });
    expect(onlyEngagement().last_staff_message_at).toBeNull();
    expect(onlyEngagement().last_member_message_at).not.toBeNull();
  });

  it("writes the opening to the member's timeline as staff, with nothing she typed", async () => {
    await start({ notes: "private words", nextStep: "other private words" });

    const row = data.activities.find((a) => a.source === "care");
    expect(row).toMatchObject({
      member_id: ADA,
      activity_type: "care_started",
      actor_kind: "staff",
      actor_user_id: CM_USER.id,
      engagement_value: 0,
      related_id: onlyEngagement().id,
      description: "A writing check-in · Slack DM",
    });
    expect(JSON.stringify(row)).not.toContain("private words");
  });

  it("refuses a second open engagement on the same channel, and starts one on another", async () => {
    await start();
    const second = await start({ reason: "welcome" });
    expect(second).toEqual({ error: expect.stringContaining("already an open engagement") });
    expect(data.careEngagements).toHaveLength(1);
    expect(data.activities.filter((a) => a.source === "care")).toHaveLength(1);

    await expect(start({ channel: "email" })).resolves.toEqual({ success: true });
    expect(data.careEngagements).toHaveLength(2);
  });

  it("checks what it is given", async () => {
    await expect(start({ memberId: "not-an-id" })).resolves.toEqual({ error: "Pick a member." });
    await expect(start({ reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
    await expect(start({ channel: "fax" })).resolves.toEqual({ error: "Pick where you are reaching out." });
    await expect(start({ notes: "x".repeat(1001) })).resolves.toEqual({ error: "The note can be at most 1000 characters." });
    await expect(start({ nextStep: "x".repeat(281) })).resolves.toEqual({ error: "The next step can be at most 280 characters." });
    await expect(start({ notes: 42 })).resolves.toEqual({ error: "Check the note." });
    await expect(start({ followUpOn: "next week" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    await expect(start({ followUpOn: "2026-02-30" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    expect(data.careEngagements).toEqual([]);
  });

  it("keeps a follow-up day and treats empty text as none", async () => {
    await start({ followUpOn: "2026-03-08", notes: "   ", nextStep: "" });
    expect(onlyEngagement()).toMatchObject({ follow_up_on: "2026-03-08", notes: null, next_step: null });
  });

  it("says it could not start when the database fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "open").mockRejectedValueOnce(new Error("connection reset"));
    await expect(start()).resolves.toEqual({ error: "Couldn't start the engagement." });
  });

  it("still starts when the timeline mirror fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "record").mockRejectedValueOnce(new Error("timeline down"));
    await expect(start()).resolves.toEqual({ success: true });
    expect(data.careEngagements).toHaveLength(1);
  });
});

describe("the rest of an engagement's life", () => {
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    await start();
    id = onlyEngagement().id;
  });

  it("logs that they replied, and that she did", async () => {
    await expect(logCareMessage(id, "member")).resolves.toEqual({ success: true });
    expect(onlyEngagement().last_member_message_at).not.toBeNull();
    await expect(logCareMessage(id, "staff")).resolves.toEqual({ success: true });
    await expect(logCareMessage(id, "robot")).resolves.toEqual({ error: "That engagement is gone." });
    await expect(logCareMessage("nope", "member")).resolves.toEqual({ error: "That engagement is gone." });
  });

  it("will not log into a closed engagement", async () => {
    await closeEngagement(id, "no_reply");
    await expect(logCareMessage(id, "member")).resolves.toEqual({ error: "That engagement is closed or gone." });
  });

  it("updates the reason, notes, next step and follow-up day, and clears with empty text", async () => {
    await expect(updateEngagement(id, { reason: "encouragement", notes: "n", nextStep: "s", followUpOn: "2026-04-01" })).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ reason: "encouragement", notes: "n", next_step: "s", follow_up_on: "2026-04-01" });

    await updateEngagement(id, { notes: "", nextStep: null, followUpOn: "" });
    expect(onlyEngagement()).toMatchObject({ notes: null, next_step: null, follow_up_on: null, reason: "encouragement" });
  });

  it("checks an update", async () => {
    await expect(updateEngagement("nope", {})).resolves.toEqual({ error: "That engagement is gone." });
    await expect(updateEngagement(id, { reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
    await expect(updateEngagement(id, { notes: "x".repeat(1001) })).resolves.toEqual({ error: "The note can be at most 1000 characters." });
    await expect(updateEngagement(id, { nextStep: "x".repeat(281) })).resolves.toEqual({ error: "The next step can be at most 280 characters." });
    await expect(updateEngagement(id, { followUpOn: "tomorrow" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    await expect(updateEngagement("care_ZZZZZZZZZZZZ", { notes: "x" })).resolves.toEqual({ error: "That engagement is gone." });
  });

  it("closes with how it ended, once, and puts it on the member's timeline", async () => {
    await expect(closeEngagement(id, "back_in_community")).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ ended_how: "back_in_community" });
    expect(onlyEngagement().closed_at).not.toBeNull();

    const closing = data.activities.filter((a) => a.source === "care" && a.activity_type === "care_closed");
    expect(closing).toHaveLength(1);
    expect(closing[0]).toMatchObject({ member_id: ADA, actor_kind: "staff", engagement_value: 0, description: "A writing check-in · Slack DM: Back in the community" });

    await expect(closeEngagement(id, "no_reply")).resolves.toEqual({ error: "That engagement is already closed or gone." });
    expect(data.activities.filter((a) => a.activity_type === "care_closed")).toHaveLength(1);
  });

  it("will not close with 'renewed': only Renew sets that", async () => {
    await expect(closeEngagement(id, "renewed")).resolves.toEqual({ error: "Pick how it ended." });
    expect(onlyEngagement().closed_at).toBeNull();
  });

  it("refuses a close without a real ending", async () => {
    await expect(closeEngagement(id, "vanished")).resolves.toEqual({ error: "Pick how it ended." });
    await expect(closeEngagement("nope", "no_reply")).resolves.toEqual({ error: "That engagement is gone." });
    expect(onlyEngagement().closed_at).toBeNull();
  });

  it("removes an engagement from the list", async () => {
    await expect(deleteEngagement(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement().deleted_at).not.toBeNull();
    await expect(deleteEngagement(id)).resolves.toEqual({ error: "That engagement is gone." });
    await expect(deleteEngagement("nope")).resolves.toEqual({ error: "That engagement is gone." });
  });

  it.each([
    ["logCareMessage", "logMessage", () => logCareMessage(id, "member"), "Couldn't save that."],
    ["updateEngagement", "update", () => updateEngagement(id, { notes: "x" }), "Couldn't save the change."],
    ["closeEngagement", "close", () => closeEngagement(id, "no_reply"), "Couldn't close the engagement."],
    ["deleteEngagement", "softDelete", () => deleteEngagement(id), "Couldn't remove the engagement."],
  ] as const)("%s says so when the database fails, without its message", async (_name, method, call, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, method).mockRejectedValueOnce(new Error("connection reset"));
    await expect(call()).resolves.toEqual({ error: message });
  });
});

describe("searchCareMembers", () => {
  it("finds members by name for the picker, display name first", async () => {
    signInAs(CM_USER);
    await expect(searchCareMembers("  ada ")).resolves.toEqual([{ id: ADA, name: "Ada E.", detail: "Ada Example · ada@example.test" }]);
  });

  it("finds no one for an empty search, a plain member or a signed-out caller", async () => {
    signInAs(CM_USER);
    await expect(searchCareMembers("   ")).resolves.toEqual([]);
    signInAs(MEMBER_USER);
    await expect(searchCareMembers("ada")).resolves.toEqual([]);
    signInAs(null);
    await expect(searchCareMembers("ada")).resolves.toEqual([]);
  });
});

describe.each([
  ["23:30 on Mar 1 Eastern (still Mar 2 04:30 in UTC)", "2026-03-02T04:30:00Z", "2026-03-01"],
  ["00:30 on Mar 2 Eastern (05:30 in UTC)", "2026-03-02T05:30:00Z", "2026-03-02"],
  ["the day of the spring clock change, 03:30 Eastern", "2026-03-08T07:30:00Z", "2026-03-08"],
  ["the evening before the fall clock change, 23:30 Eastern", "2026-11-01T03:30:00Z", "2026-10-31"],
])("the period of an engagement started at %s", (_label, startIso, easternDay) => {
  useFakeClock(() => Date.parse(startIso));
  beforeEach(() => signInAs(CM_USER));

  it("ends on the Eastern calendar day the configured number of days after it opened, and so does a renewal", async () => {
    await start();
    expect(onlyEngagement().period_ends_on).toBe(addDays(easternDay, CARE_ENGAGEMENT_DAYS));
    expect(onlyEngagement().period_ends_on).toBe(periodEndsOn(new Date(startIso)));

    await renewEngagement(onlyEngagementId(), "a plan");
    expect(data.careEngagements[1].period_ends_on).toBe(addDays(easternDay, CARE_ENGAGEMENT_DAYS));
  });
});

describe("renewEngagement", () => {
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    await start({ notes: "first period" });
    id = onlyEngagement().id;
  });

  it("closes this period as renewed, opens the next linked to it, and writes one timeline row for it", async () => {
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ success: true });

    expect(data.careEngagements).toHaveLength(2);
    const [old, next] = data.careEngagements;
    expect(old).toMatchObject({ id, ended_how: "renewed" });
    expect(old.closed_at).not.toBeNull();
    expect(next).toMatchObject({ member_id: ADA, opened_by: CM_USER.id, renewed_from: id, closed_at: null, owned_by: CM_USER.id, notes: "a plan", reason: "writing_check_in", channel: "slack_dm" });
    expect(next.period_ends_on >= old.period_ends_on).toBe(true);

    const rows = data.activities.filter((a) => a.source === "care" && a.activity_type === "care_renewed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ member_id: ADA, actor_kind: "staff", engagement_value: 0, related_id: next.id });
    expect(data.activities.filter((a) => a.activity_type === "care_closed")).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care/earlier");
  });

  it("opens one period for a double click, and tells the second click why", async () => {
    const [a, b] = await Promise.all([renewEngagement(id, "a plan"), renewEngagement(id, "a plan")]);
    expect([a, b].filter((r) => "success" in r)).toHaveLength(1);
    expect([a, b].find((r) => "error" in r)).toEqual({ error: expect.stringContaining("already renewed, closed or gone") });
    expect(data.careEngagements.filter((c) => c.closed_at === null)).toHaveLength(1);
    expect(data.careEngagements).toHaveLength(2);
  });

  it("checks the id, and answers a closed or missing engagement", async () => {
    await expect(renewEngagement("nope", "a plan")).resolves.toEqual({ error: "That engagement is gone." });
    await closeEngagement(id, "no_reply");
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ error: expect.stringContaining("already renewed, closed or gone") });
  });

  it("needs a reason, which becomes the new period's note, and keeps the old note on the old period", async () => {
    await expect(renewEngagement(id, "   ")).resolves.toEqual({ error: "Say why you are renewing: what is the plan?" });
    await expect(renewEngagement(id, "x".repeat(1001))).resolves.toEqual({ error: "The reason can be at most 1000 characters." });
    await expect(renewEngagement(id, 42 as never)).resolves.toEqual({ error: "Check the reason." });
    expect(data.careEngagements).toHaveLength(1); // nothing happened

    await renewEngagement(id, "  they answered, a writing sprint is planned  ");
    expect(data.careEngagements[0]).toMatchObject({ notes: "first period", ended_how: "renewed" });
    expect(data.careEngagements[1].notes).toBe("they answered, a writing sprint is planned");
  });

  it("keeps the owner, even when someone else renews it, and can renew one that is long past its period", async () => {
    data.careEngagements[0].owned_by = OWNER_B;
    data.careEngagements[0].period_ends_on = "2020-01-01"; // lapsed
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ success: true });
    expect(data.careEngagements[1]).toMatchObject({ owned_by: OWNER_B, opened_by: CM_USER.id });
  });

  it("says it could not renew when the database fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "renew").mockRejectedValueOnce(new Error("connection reset"));
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ error: "Couldn't renew the engagement." });
  });
});

describe("getEngagementResults", () => {
  const OPENED = "2026-03-01T15:00:00.000Z";
  useFakeClock(() => Date.parse("2026-03-20T15:00:00Z"));
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    data.careEngagements.push({
      id: "care_AAAAAAAAAAA9",
      member_id: ADA,
      opened_by: CM_USER.id,
      owned_by: CM_USER.id,
      reason: "check_in",
      channel: "slack_dm",
      opened_at: OPENED,
      period_ends_on: "2026-03-31",
      renewed_from: null,
      closed_at: null,
      ended_how: null,
      last_staff_message_at: OPENED,
      last_member_message_at: null,
      follow_up_on: null,
      next_step: null,
      notes: null,
      deleted_at: null,
      created_at: OPENED,
      updated_at: OPENED,
    });
    id = "care_AAAAAAAAAAA9";
  });

  it("counts the three windows from the member's own activity, and says not yet for after", async () => {
    await repos.activities.record({ memberId: ADA, type: "prickle_attended", category: "event", title: "Attended", occurredAt: "2026-02-15T15:00:00Z", source: "prickle_attendance", relatedId: "prkl_AAAAAAAAAAA1" });
    await repos.activities.record({ memberId: ADA, type: "prickle_attended", category: "event", title: "Attended", occurredAt: "2026-03-10T15:00:00Z", source: "prickle_attendance", relatedId: "prkl_AAAAAAAAAAA2" });

    const answer = await getEngagementResults(id);

    expect("results" in answer).toBe(true);
    if (!("results" in answer)) return;
    expect(answer.results.windows.before.counts).toMatchObject({ pricklesAttended: 1, firstPrickle: true });
    expect(answer.results.windows.during.counts).toMatchObject({ pricklesAttended: 1, firstPrickle: false });
    expect(answer.results.windows.after.counts).toBeNull();
    expect(answer.results.retention.checkpoints.length).toBeGreaterThan(0);
    expect(answer.results.retention.checkpoints.every((c) => c.state === "not_yet")).toBe(true);
    expect(answer.results.retention.firstLapse).toBeNull();
  });

  it("refuses a bad id, an unknown engagement and a plain member", async () => {
    await expect(getEngagementResults("nope")).resolves.toEqual({ error: "That engagement is gone." });
    await expect(getEngagementResults("care_ZZZZZZZZZZZZ")).resolves.toEqual({ error: "That engagement is gone." });
    signInAs(MEMBER_USER);
    await expect(getEngagementResults(id)).resolves.toEqual({ error: "Not authorized" });
  });

  it("says it could not count when a read fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "firsts").mockRejectedValueOnce(new Error("connection reset"));
    await expect(getEngagementResults(id)).resolves.toEqual({ error: "Couldn't work out the results." });
  });
});

describe("who owns an engagement", () => {
  beforeEach(() => signInAs(CM_USER));

  it("goes to whoever starts it, when the member has had none before", async () => {
    await start();
    expect(onlyEngagement().owned_by).toBe(CM_USER.id);
  });

  it("goes to the owner of the member's latest engagement, whoever starts it (continuity), and not to an older one's", async () => {
    data.careEngagements.push(
      { ...engagementRow("care_BBBBBBBBBBB1", ADA, "2026-01-01T10:00:00Z"), owned_by: NOT_STAFF, closed_at: "2026-01-20T10:00:00Z", ended_how: "ran_its_course" },
      { ...engagementRow("care_BBBBBBBBBBB2", ADA, "2026-02-01T10:00:00Z"), owned_by: OWNER_B, closed_at: "2026-02-20T10:00:00Z", ended_how: "no_reply" }
    );
    await expect(start()).resolves.toEqual({ success: true });
    expect(data.careEngagements.at(-1)).toMatchObject({ opened_by: CM_USER.id, owned_by: OWNER_B });
  });

  it("goes to whoever starts it when the latest engagement had no owner, and ignores a removed one", async () => {
    data.careEngagements.push(
      { ...engagementRow("care_BBBBBBBBBBB1", ADA, "2026-02-01T10:00:00Z"), owned_by: null, closed_at: "2026-02-20T10:00:00Z", ended_how: "no_reply" },
      { ...engagementRow("care_BBBBBBBBBBB2", ADA, "2026-03-01T10:00:00Z"), owned_by: OWNER_B, closed_at: "2026-03-05T10:00:00Z", ended_how: "no_reply", deleted_at: "2026-03-06T10:00:00Z" }
    );
    await start();
    expect(data.careEngagements.at(-1)?.owned_by).toBe(CM_USER.id);
  });
});

describe("reassignEngagement", () => {
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    await start();
    id = onlyEngagement().id;
  });

  it("hands an open engagement to another admin or community manager", async () => {
    await expect(reassignEngagement(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement().owned_by).toBe(OWNER_B);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care/earlier");
  });

  it("hands a closed one over too", async () => {
    await closeEngagement(id, "ran_its_course");
    await expect(reassignEngagement(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: OWNER_B, ended_how: "ran_its_course" });
  });

  it("refuses someone who is not on the team, something that is not an id, and an engagement that is gone", async () => {
    await expect(reassignEngagement(id, NOT_STAFF)).resolves.toEqual({ error: "Pick someone on the team." });
    await expect(reassignEngagement(id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).resolves.toEqual({ error: "Pick someone on the team." }); // no profile
    await expect(reassignEngagement(id, "not-a-user")).resolves.toEqual({ error: "Pick who it goes to." });
    await expect(reassignEngagement(id, undefined as never)).resolves.toEqual({ error: "Pick who it goes to." });
    await expect(reassignEngagement("nope", OWNER_B)).resolves.toEqual({ error: "That engagement is gone." });
    await expect(reassignEngagement("care_ZZZZZZZZZZZZ", OWNER_B)).resolves.toEqual({ error: "That engagement is gone." });
    expect(onlyEngagement().owned_by).toBe(CM_USER.id);
  });

  it("says it could not hand it over when the database fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "reassign").mockRejectedValueOnce(new Error("connection reset"));
    await expect(reassignEngagement(id, OWNER_B)).resolves.toEqual({ error: "Couldn't hand it over." });
  });
});

describe("tracking Slack DMs", () => {
  const CM_MEMBER = "mbr_CCCCCCCCCCC1";
  const STAFF_MEMBER = "mbr_SSSSSSSSSSS1";
  const NO_DM_MEMBER = "mbr_AAAAAAAAAAA9";
  const U = { cm: "U0CM00001", ada: "U0ADA0001", bo: "U0BO00001", staff: "U0STAFF01" };
  const D = { ada: "D0ADA0001", bo: "D0BO00001", staff: "D0STAFF01", others: "D0OTHERS1" };
  const SECRET_TEXT = "words that must never be read";
  const members = (userId: string | null) => [
    { id: CM_MEMBER, name: "Cam Example", email: "cm@example.test", userId },
    { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
    { id: BO, name: "Bo Example", email: "bo@example.test" },
    { id: STAFF_MEMBER, name: "Sam Staffer", email: "staffer@example.test" },
    { id: NO_DM_MEMBER, name: "Di Example", email: "di@example.test" },
  ];
  const memberships = (channel_id: string, ...users: string[]) => users.map((user_id) => ({ channel_id, user_id, left_at: null, imported_at: "2026-01-01T00:00:00.000Z" }));
  const dmMessage = (channel_id: string, user_id: string, occurred_at: string) => ({ channel_id, message_ts: `${Date.parse(occurred_at) / 1000}.000100`, user_id, occurred_at, text: SECRET_TEXT });

  function world({ bridge = true, connected = true }: { bridge?: boolean; connected?: boolean } = {}) {
    data = new InMemoryDataset({
      members: members(CM_USER.id),
      userProfiles: [
        { id: CM_USER.id, email: CM_USER.email, role: "community_manager" },
        { id: ADMIN_USER.id, email: ADMIN_USER.email!, role: "admin" },
      ],
      staff: [{ id: "staff_AAAAAAAAAAA1", email: "staffer@example.test", name: "Sam Staffer", role: "host", member_id: STAFF_MEMBER, hire_date: null, notes: null, created_at: null, updated_at: null }],
      chatSlackAuthors: [
        { slack_user_id: U.cm, member_id: CM_MEMBER },
        { slack_user_id: U.ada, member_id: ADA },
        { slack_user_id: U.bo, member_id: BO },
        { slack_user_id: U.staff, member_id: STAFF_MEMBER },
      ],
      slackConnections: connected
        ? [{ member_id: CM_MEMBER, slack_user_id: U.cm, team_id: null, scopes: [...SLACK_DM_SCOPES], connected_at: "2026-01-01T00:00:00.000Z", revoked_at: null, access_secret_id: null, refresh_secret_id: null, expires_at: null, dms_pulled_at: null, read_pulled_at: null }]
        : [],
      slackChannels: [D.ada, D.bo, D.staff, D.others].map((channel_id) => ({ channel_id, name: "", is_im: true, is_private: true })),
      slackChannelMembers: [...memberships(D.ada, U.cm, U.ada), ...memberships(D.bo, U.bo, U.cm), ...memberships(D.staff, U.cm, U.staff), ...memberships(D.others, U.ada, U.bo)],
      slackMessages: [dmMessage(D.ada, U.ada, new Date(Date.now() + 3600_000).toISOString())],
      featureFlags: bridge ? [{ feature_key: "slack_dm_bridge", enabled_globally: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }] : [],
    });
    repos = createInMemoryRepos(data);
    signInAs(CM_USER);
  }

  describe("trackCareDm", () => {
    it("tracks one of her DMs with a member, as herself, and says nothing is wrong", async () => {
      world();
      await expect(trackCareDm(D.ada)).resolves.toEqual({ success: true });
      expect(data.careTrackedDms).toHaveLength(1);
      expect(data.careTrackedDms[0]).toMatchObject({ tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, deleted_at: null });
      expect(revalidatePath).toHaveBeenCalledWith("/admin/care/dms");
    });

    it("fills in who spoke last on her open Slack DM engagement at once", async () => {
      world({ bridge: false });
      await start(); // no bridge yet: nothing is tracked, nothing filled in
      expect(onlyEngagement().last_member_message_at).toBeNull();
      data.featureFlags.push({ feature_key: "slack_dm_bridge", enabled_globally: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });

      await trackCareDm(D.ada);

      expect(onlyEngagement().last_member_message_at).not.toBeNull();
    });

    it("tracking it again is not an error and adds nothing", async () => {
      world();
      await trackCareDm(D.ada);
      await expect(trackCareDm(D.ada)).resolves.toEqual({ success: true });
      expect(data.careTrackedDms).toHaveLength(1);
    });

    it.each([
      ["someone else's DM", D.others],
      ["a DM with a staff member", D.staff],
      ["a conversation nobody has", "D0NOSUCH01"],
    ])("refuses %s", async (_label, channel) => {
      world();
      await expect(trackCareDm(channel)).resolves.toEqual({ error: "That DM isn't one you can track." });
      expect(data.careTrackedDms).toEqual([]);
    });

    it.each([[undefined], [""], ["d0lowercase"], ["D0 WITH SPACE"], [42], [`D${"0".repeat(60)}`]])("refuses a value that is not a Slack conversation id (%s)", async (value) => {
      world();
      await expect(trackCareDm(value as never)).resolves.toEqual({ error: "That DM isn't available." });
      expect(data.careTrackedDms).toEqual([]);
    });

    it("refuses when the Slack DM bridge is not on for her", async () => {
      world({ bridge: false });
      await expect(trackCareDm(D.ada)).resolves.toEqual({ error: "Slack DMs aren't switched on for you yet." });
      expect(data.careTrackedDms).toEqual([]);
    });

    it("refuses when she has no Slack account connected", async () => {
      world({ connected: false });
      await expect(trackCareDm(D.ada)).resolves.toEqual({ error: "That DM isn't one you can track." });
    });

    it("says it could not track it when the database fails, without its message or anything from Slack", async () => {
      world();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.careDms, "track").mockRejectedValueOnce(new Error("connection reset"));
      await expect(trackCareDm(D.ada)).resolves.toEqual({ error: "Couldn't track that DM." });
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET_TEXT);
    });
  });

  describe("untrackCareDm", () => {
    it("stops tracking one, keeps the row, and leaves the times it already filled in", async () => {
      world();
      await start(); // tracks her DM with Ada
      const filled = onlyEngagement().last_member_message_at;
      expect(filled).not.toBeNull();

      await expect(untrackCareDm(D.ada)).resolves.toEqual({ success: true });

      expect(data.careTrackedDms).toHaveLength(1);
      expect(data.careTrackedDms[0].deleted_at).not.toBeNull();
      expect(onlyEngagement().last_member_message_at).toBe(filled);
      expect(revalidatePath).toHaveBeenCalledWith("/admin/care/dms");
    });

    it("says so when it was not tracked, and refuses a value that is not a conversation id", async () => {
      world();
      await expect(untrackCareDm(D.ada)).resolves.toEqual({ error: "That DM isn't tracked." });
      await expect(untrackCareDm("nope" as never)).resolves.toEqual({ error: "That DM isn't available." });
    });

    it("is not allowed to untrack someone else's: only her own row is touched", async () => {
      world();
      data.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: ADMIN_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: "2026-01-01T00:00:00.000Z", deleted_at: null });
      await expect(untrackCareDm(D.ada)).resolves.toEqual({ error: "That DM isn't tracked." });
      expect(data.careTrackedDms[0].deleted_at).toBeNull();
    });

    it("says it could not stop tracking it when the database fails", async () => {
      world();
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.careDms, "untrack").mockRejectedValueOnce(new Error("connection reset"));
      await expect(untrackCareDm(D.ada)).resolves.toEqual({ error: "Couldn't stop tracking that DM." });
    });
  });

  describe("starting a Slack DM engagement", () => {
    it("tracks her DM with that member when she has one, and fills in who spoke last from it", async () => {
      world();
      await expect(start({ memberId: ADA })).resolves.toEqual({ success: true });

      expect(data.careTrackedDms).toHaveLength(1);
      expect(data.careTrackedDms[0]).toMatchObject({ tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA });
      expect(onlyEngagement().last_member_message_at).not.toBeNull();
    });

    it("tracks nothing when she has no DM with them, when the engagement is on another channel, or when the bridge is off", async () => {
      world();
      await start({ memberId: NO_DM_MEMBER });
      expect(data.careEngagements).toHaveLength(1);
      expect(data.careTrackedDms).toEqual([]);
      await start({ memberId: BO, channel: "email" });
      expect(data.careTrackedDms).toEqual([]);

      world({ bridge: false });
      await start({ memberId: ADA });
      expect(data.careTrackedDms).toEqual([]);
      expect(data.careEngagements).toHaveLength(1);
    });

    it("never tracks a DM with a staff member, even when she starts an engagement with one", async () => {
      world();
      await expect(start({ memberId: STAFF_MEMBER })).resolves.toEqual({ success: true });
      expect(data.careTrackedDms).toEqual([]);
    });

    it("still starts the engagement when tracking the DM fails, and logs only the error", async () => {
      world();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.careDms, "track").mockRejectedValueOnce(new Error("connection reset"));

      await expect(start({ memberId: ADA })).resolves.toEqual({ success: true });

      expect(data.careEngagements).toHaveLength(1);
      expect(log).toHaveBeenCalledWith("[care] tracking the DM of a new engagement failed:", "connection reset");
    });

    it("lets her untrack it afterwards", async () => {
      world();
      await start({ memberId: ADA });
      await expect(untrackCareDm(D.ada)).resolves.toEqual({ success: true });
      expect(data.careTrackedDms[0].deleted_at).not.toBeNull();
    });
  });
});
