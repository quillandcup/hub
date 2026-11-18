import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { periodEndsOn } from "@/lib/care";
import { CARE_ENGAGEMENT_DAYS } from "@/lib/config";
import { addDays } from "@/lib/org-week";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import { ADMIN_USER, MEMBER_USER, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { FakeClock, useFakeClock } from "@/tests/helpers/fake-clock";
import { setClock } from "@/lib/clock";

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
const ASSISTANT = { id: "user-assistant", email: "assistant@example.test" };
const OWNER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // another admin
const NOT_STAFF = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // a member with a profile
const ADMIN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // an admin whose id is a uuid, as the picker's are
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
  changeEngagementStart,
  closeEngagement,
  deleteEngagement,
  getCareMessages,
  getEngagementResults,
  loadCarePlanActivity,
  acceptCareHandover,
  cancelCareHandover,
  claimCarePlan,
  declineCareHandover,
  dismissCareTakeoverNotice,
  loadPreviousCareOwner,
  logCareMessage,
  proposeCareHandover,
  renewEngagement,
  searchCareMembers,
  startEngagement,
  takeOverCarePlan,
  updateEngagement,
} from "@/app/(admin)/admin/care/actions";
import { SLACK_DM_SCOPES } from "@/lib/slack-connect";

const start = (over: Record<string, unknown> = {}) => startEngagement({ memberId: ADA, reason: "writing_check_in", ...over });
const engagementRow = (id: string, member: string, openedAt: string) => ({
  id,
  member_id: member,
  opened_by: null,
  owned_by: null,
  reason: "check_in",
  opened_at: openedAt,
  period_ends_on: "2026-12-31",
  renewed_from: null,
  closed_at: null,
  ended_how: null,
  last_staff_message_at: openedAt,
  last_member_message_at: null,
  follow_up_on: null,
  handover_to: null,
  handover_by: null,
  handover_at: null,
  taken_from: null,
  taken_by: null,
  taken_at: null,
  taken_seen_at: null,
  next_step: null,
  notes: null,
  deleted_at: null,
  created_at: openedAt,
  updated_at: openedAt,
});
const onlyEngagementId = () => data.careEngagements[0].id;
const onlyEngagementOf = (id: string) => data.careEngagements.find((c) => c.id === id)!;
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
      { id: ADMIN_B, email: "admin-b@example.test", role: "admin" },
      { id: NOT_STAFF, email: "plain-b@example.test", role: "member" },
      { id: ASSISTANT.id, email: ASSISTANT.email, role: "assistant" },
    ],
  });
  repos = createInMemoryRepos(data);
});

describe("who may write Hedgie Care", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["startEngagement", () => start()],
    ["logCareMessage", () => logCareMessage("care_AAAAAAAAAAA1", "member")],
    ["changeEngagementStart", () => changeEngagementStart("care_AAAAAAAAAAA1", "2026-03-01")],
    ["updateEngagement", () => updateEngagement("care_AAAAAAAAAAA1", { notes: "x" })],
    ["closeEngagement", () => closeEngagement("care_AAAAAAAAAAA1", "no_reply")],
    ["renewEngagement", () => renewEngagement("care_AAAAAAAAAAA1", "a plan")],
    ["proposeCareHandover", () => proposeCareHandover("care_AAAAAAAAAAA1", OWNER_B)],
    ["acceptCareHandover", () => acceptCareHandover("care_AAAAAAAAAAA1")],
    ["declineCareHandover", () => declineCareHandover("care_AAAAAAAAAAA1")],
    ["cancelCareHandover", () => cancelCareHandover("care_AAAAAAAAAAA1")],
    ["claimCarePlan", () => claimCarePlan("care_AAAAAAAAAAA1")],
    ["takeOverCarePlan", () => takeOverCarePlan("care_AAAAAAAAAAA1")],
    ["dismissCareTakeoverNotice", () => dismissCareTakeoverNotice("care_AAAAAAAAAAA1")],
    ["getEngagementResults", () => getEngagementResults("care_AAAAAAAAAAA1")],
    ["getCareMessages", () => getCareMessages(ADA)],
    ["loadCarePlanActivity", () => loadCarePlanActivity("care_AAAAAAAAAAA1")],
    ["deleteEngagement", () => deleteEngagement("care_AAAAAAAAAAA1")],
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
    expect(onlyEngagement()).toMatchObject({ member_id: ADA, opened_by: CM_USER.id, reason: "writing_check_in", notes: "said hello" });
    expect(onlyEngagement()).not.toHaveProperty("channel"); // a plan belongs to the member: the column is gone
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

  it("starts with her message: who spoke first is not asked, a tracked DM or the log buttons say so later", async () => {
    await start();
    expect(onlyEngagement()).toMatchObject({ last_member_message_at: null });
    expect(onlyEngagement().last_staff_message_at).not.toBeNull();
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
      description: "A writing check-in",
    });
    expect(JSON.stringify(row)).not.toContain("private words");
  });

  it("refuses a second open care plan with the same member, however it is started, and starts one with another member", async () => {
    await start();
    const second = await start({ reason: "welcome" });
    expect(second).toEqual({ error: "There is already an open care plan with them. Log a message there, or renew it." });
    expect(data.careEngagements).toHaveLength(1);
    expect(data.activities.filter((a) => a.source === "care")).toHaveLength(1);

    await expect(start({ memberId: BO })).resolves.toEqual({ success: true });
    expect(data.careEngagements).toHaveLength(2);
  });

  it("checks what it is given", async () => {
    await expect(start({ memberId: "not-an-id" })).resolves.toEqual({ error: "Pick a member." });
    await expect(start({ reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
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
    await expect(start()).resolves.toEqual({ error: "Couldn't start the care plan." });
  });

  it("still starts when the timeline mirror fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "record").mockRejectedValueOnce(new Error("timeline down"));
    await expect(start()).resolves.toEqual({ success: true });
    expect(data.careEngagements).toHaveLength(1);
  });
});

describe("backdating a care plan", () => {
  useFakeClock(() => Date.parse("2026-03-20T15:00:00Z"));
  /** Moves the pinned clock to an exact instant. */
  const at = (iso: string) => setClock(new FakeClock(Date.parse(iso)));
  beforeEach(() => signInAs(CM_USER));

  it("starts today at this moment when no day is given, or today is given", async () => {
    await start();
    expect(onlyEngagement().opened_at).toBe("2026-03-20T15:00:00.000Z");
    expect(onlyEngagement().period_ends_on).toBe(addDays("2026-03-20", CARE_ENGAGEMENT_DAYS));

    data.careEngagements = [];
    await start({ startedOn: "2026-03-20" });
    expect(onlyEngagement().opened_at).toBe("2026-03-20T15:00:00.000Z");
  });

  it("starts an earlier day at noon Eastern of it, with the period running from that day and her message at that time", async () => {
    await expect(start({ startedOn: "2026-03-13" })).resolves.toEqual({ success: true });

    expect(onlyEngagement()).toMatchObject({
      opened_at: "2026-03-13T16:00:00.000Z", // noon EDT
      period_ends_on: periodEndsOn(new Date("2026-03-13T16:00:00.000Z")),
      last_staff_message_at: "2026-03-13T04:00:00.000Z", // the start of that Eastern day, so a real DM from that morning can replace it
      last_member_message_at: null,
    });
    expect(onlyEngagement().period_ends_on).toBe(addDays("2026-03-13", CARE_ENGAGEMENT_DAYS));
    // The member's timeline shows it on the day it started.
    expect(data.activities.find((a) => a.source === "care")?.occurred_at).toBe("2026-03-13T16:00:00.000Z");
  });

  it("refuses a day after today and a day that is not real, and saves nothing", async () => {
    await expect(start({ startedOn: "2026-03-21" })).resolves.toEqual({ error: "The start can't be in the future. Pick today or an earlier day." });
    await expect(start({ startedOn: "2026-02-30" })).resolves.toEqual({ error: "That isn't a real day. Pick the day it started." });
    await expect(start({ startedOn: "last week" })).resolves.toEqual({ error: "That isn't a real day. Pick the day it started." });
    expect(data.careEngagements).toEqual([]);
  });

  it("goes by the Eastern day on both sides of Eastern midnight", async () => {
    at("2026-03-12T03:30:00.000Z"); // 23:30 on Mar 11 in Eastern time, though it is already Mar 12 in UTC
    await expect(start({ startedOn: "2026-03-12" })).resolves.toEqual({ error: expect.stringContaining("future") });
    await expect(start({ startedOn: "2026-03-11" })).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ opened_at: "2026-03-12T03:30:00.000Z", period_ends_on: "2026-04-10" });

    data.careEngagements = [];
    at("2026-03-12T04:30:00.000Z"); // 00:30 on Mar 12 in Eastern time
    await expect(start({ startedOn: "2026-03-12" })).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ opened_at: "2026-03-12T04:30:00.000Z", period_ends_on: "2026-04-11" });
  });

  it("is noon Eastern on the day the clocks go forward and the day they go back", async () => {
    await start({ startedOn: "2026-03-08" }); // 23-hour day
    expect(onlyEngagement()).toMatchObject({ opened_at: "2026-03-08T16:00:00.000Z", period_ends_on: "2026-04-07" });

    data.careEngagements = [];
    at("2026-11-10T15:00:00.000Z");
    await start({ startedOn: "2026-11-01" }); // 25-hour day
    expect(onlyEngagement()).toMatchObject({ opened_at: "2026-11-01T17:00:00.000Z", period_ends_on: "2026-12-01" });
  });

  it("still leaves one open care plan per member", async () => {
    await start({ startedOn: "2026-03-13" });
    await expect(start({ startedOn: "2026-03-14" })).resolves.toEqual({ error: expect.stringContaining("already an open care plan") });
    expect(data.careEngagements).toHaveLength(1);
  });
});

describe("changeEngagementStart", () => {
  useFakeClock(() => Date.parse("2026-03-20T15:00:00Z"));
  let id: string;
  beforeEach(async () => {
    signInAs(CM_USER);
    await start(); // today, 2026-03-20 10:00 Eastern... at 15:00Z
    id = onlyEngagement().id;
  });

  it("moves the start to an earlier day at noon Eastern, with the last day and her opening message", async () => {
    await expect(changeEngagementStart(id, "2026-03-10")).resolves.toEqual({ success: true });

    expect(onlyEngagement()).toMatchObject({
      opened_at: "2026-03-10T16:00:00.000Z",
      period_ends_on: addDays("2026-03-10", CARE_ENGAGEMENT_DAYS),
      last_staff_message_at: "2026-03-10T04:00:00.000Z",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
  });

  describe("the member's timeline row", () => {
    const careRows = (type: string) => data.activities.filter((a) => a.source === "care" && a.activity_type === type);

    it("moves to the new day with the start, and only the row of the care plan that moved", async () => {
      await start({ memberId: BO }); // another member's care plan keeps its row
      const bo = data.careEngagements.find((c) => c.member_id === BO)!;
      expect(careRows("care_started")).toHaveLength(2);
      const mine = () => careRows("care_started").find((a) => a.related_id === id)!;
      expect(mine().occurred_at).toBe("2026-03-20T15:00:00.000Z");

      await expect(changeEngagementStart(id, "2026-03-10")).resolves.toEqual({ success: true });

      expect(mine().occurred_at).toBe("2026-03-10T16:00:00.000Z");
      expect(mine().occurred_at).toBe(onlyEngagementOf(id).opened_at);
      expect(careRows("care_started").find((a) => a.related_id === bo.id)!.occurred_at).toBe("2026-03-20T15:00:00.000Z");
      expect(mine()).toMatchObject({ title: "Started a care plan", member_id: ADA });
    });

    it("moves the row of a renewal, which is where a renewed care plan's start is written, and leaves the close row", async () => {
      const first = onlyEngagement();
      await changeEngagementStart(id, "2026-03-01");
      await renewEngagement(id, "keep going");
      const renewal = data.careEngagements.find((c) => c.renewed_from === id)!;
      const closeRow = careRows("care_closed").map((a) => a.occurred_at);

      await expect(changeEngagementStart(renewal.id, "2026-03-10")).resolves.toEqual({ success: true });

      expect(careRows("care_renewed").find((a) => a.related_id === renewal.id)!.occurred_at).toBe("2026-03-10T16:00:00.000Z");
      expect(careRows("care_started").find((a) => a.related_id === first.id)!.occurred_at).toBe("2026-03-01T17:00:00.000Z");
      expect(careRows("care_closed").map((a) => a.occurred_at)).toEqual(closeRow);
    });

    it("leaves the row alone when the start did not change, and when it is refused", async () => {
      await changeEngagementStart(id, "2026-03-20");
      await changeEngagementStart(id, "2026-03-21");
      expect(careRows("care_started")[0].occurred_at).toBe("2026-03-20T15:00:00.000Z");
    });

    it("still moves the start when the timeline row cannot be moved, and says nothing is wrong", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.activities, "moveOccurredAt").mockRejectedValueOnce(new Error("timeline down"));
      await expect(changeEngagementStart(id, "2026-03-10")).resolves.toEqual({ success: true });
      expect(onlyEngagement().opened_at).toBe("2026-03-10T16:00:00.000Z");
      expect(console.error).toHaveBeenCalledWith("[care] moving the timeline row after a start change failed:", "timeline down");
    });

    it("does nothing when the care plan has no timeline row", async () => {
      data.activities.splice(0, data.activities.length);
      await expect(changeEngagementStart(id, "2026-03-10")).resolves.toEqual({ success: true });
      expect(data.activities.filter((a) => a.source === "care")).toEqual([]);
    });
  });

  it("keeps the length the period had when the setting is different now", async () => {
    onlyEngagement().period_ends_on = "2026-05-04"; // a 45-day period
    await changeEngagementStart(id, "2026-03-10");
    expect(onlyEngagement().period_ends_on).toBe("2026-04-24");
  });

  it("leaves a start alone when it is already on that Eastern day", async () => {
    const before = { ...onlyEngagement() };
    await expect(changeEngagementStart(id, "2026-03-20")).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toEqual(before);
  });

  it("refuses a day after today, a day that is not real, something that is not an id, and a care plan that is gone", async () => {
    await expect(changeEngagementStart(id, "2026-03-21")).resolves.toEqual({ error: "The start can't be in the future. Pick today or an earlier day." });
    await expect(changeEngagementStart(id, "2026-02-30")).resolves.toEqual({ error: "That isn't a real day. Pick the day it started." });
    await expect(changeEngagementStart(id, "")).resolves.toEqual({ success: true }); // none given means today
    await expect(changeEngagementStart("nope", "2026-03-10")).resolves.toEqual({ error: "That care plan is gone." });
    await expect(changeEngagementStart("care_ZZZZZZZZZZZZ", "2026-03-10")).resolves.toEqual({ error: "That care plan is gone." });
    expect(onlyEngagement().opened_at).toBe("2026-03-20T15:00:00.000Z");
  });

  it("will not move the start of a renewal before the care plan it continues, and says which day stops it", async () => {
    await changeEngagementStart(id, "2026-03-05");
    await renewEngagement(id, "a plan");
    const renewal = data.careEngagements.find((c) => c.renewed_from === id)!;

    await expect(changeEngagementStart(renewal.id, "2026-03-04")).resolves.toEqual({ error: "The start can't be before the care plan this one follows on from, which started on 3/5/2026." });
    expect(renewal.opened_at).toBe("2026-03-20T15:00:00.000Z");
    // A renewal's start is the renewal day; it can move, but only inside the order of the chain.
    await expect(changeEngagementStart(renewal.id, "2026-03-12")).resolves.toEqual({ success: true });
    expect(renewal.period_ends_on).toBe(addDays("2026-03-12", CARE_ENGAGEMENT_DAYS));
  });

  it("will not move a care plan past the start of its renewal, and clamps a start on the renewal's own day to its time", async () => {
    await renewEngagement(id, "a plan");
    const first = data.careEngagements.find((c) => c.id === id)!;
    const renewal = data.careEngagements.find((c) => c.renewed_from === id)!;
    first.opened_at = "2026-03-05T16:00:00.000Z";
    renewal.opened_at = first.closed_at = "2026-03-12T14:00:00.000Z"; // 10:00 Eastern

    await expect(changeEngagementStart(id, "2026-03-13")).resolves.toEqual({ error: "The start can't be after this care plan was renewed, on 3/12/2026. Change the start of the next care plan first." });
    expect(first.opened_at).toBe("2026-03-05T16:00:00.000Z");
    // Its renewal's own day is fine: noon would be after the renewal's morning, so it starts when the renewal did.
    await expect(changeEngagementStart(id, "2026-03-12")).resolves.toEqual({ success: true });
    expect(first.opened_at).toBe("2026-03-12T14:00:00.000Z");
  });

  it("will not move a closed care plan to after it was closed", async () => {
    await closeEngagement(id, "no_reply");
    onlyEngagement().opened_at = "2026-03-10T16:00:00.000Z";
    onlyEngagement().closed_at = "2026-03-15T16:00:00.000Z";

    await expect(changeEngagementStart(id, "2026-03-16")).resolves.toEqual({ error: "The start can't be after this care plan was closed, on 3/15/2026." });
    await expect(changeEngagementStart(id, "2026-03-12")).resolves.toEqual({ success: true });
  });

  it("says it could not change it when the database fails, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "changeStart").mockRejectedValueOnce(new Error("connection reset"));
    await expect(changeEngagementStart(id, "2026-03-10")).resolves.toEqual({ error: "Couldn't change the start date." });
  });

  it("writes nothing to the member's timeline and does not add one for the change", async () => {
    const before = data.activities.length;
    await changeEngagementStart(id, "2026-03-10");
    expect(data.activities).toHaveLength(before);
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
    await expect(logCareMessage(id, "robot")).resolves.toEqual({ error: "That care plan is gone." });
    await expect(logCareMessage("nope", "member")).resolves.toEqual({ error: "That care plan is gone." });
  });

  it("will not log into a closed engagement", async () => {
    await closeEngagement(id, "no_reply");
    await expect(logCareMessage(id, "member")).resolves.toEqual({ error: "That care plan is closed or gone." });
  });

  it("updates the reason, notes, next step and follow-up day, and clears with empty text", async () => {
    await expect(updateEngagement(id, { reason: "encouragement", notes: "n", nextStep: "s", followUpOn: "2026-04-01" })).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ reason: "encouragement", notes: "n", next_step: "s", follow_up_on: "2026-04-01" });

    await updateEngagement(id, { notes: "", nextStep: null, followUpOn: "" });
    expect(onlyEngagement()).toMatchObject({ notes: null, next_step: null, follow_up_on: null, reason: "encouragement" });
  });

  it("checks an update", async () => {
    await expect(updateEngagement("nope", {})).resolves.toEqual({ error: "That care plan is gone." });
    await expect(updateEngagement(id, { reason: "gossip" })).resolves.toEqual({ error: "Pick why you are reaching out." });
    await expect(updateEngagement(id, { notes: "x".repeat(1001) })).resolves.toEqual({ error: "The note can be at most 1000 characters." });
    await expect(updateEngagement(id, { nextStep: "x".repeat(281) })).resolves.toEqual({ error: "The next step can be at most 280 characters." });
    await expect(updateEngagement(id, { followUpOn: "tomorrow" })).resolves.toEqual({ error: "Pick a real day for the follow-up." });
    await expect(updateEngagement("care_ZZZZZZZZZZZZ", { notes: "x" })).resolves.toEqual({ error: "That care plan is gone." });
  });

  it("closes with how it ended, once, and puts it on the member's timeline", async () => {
    await expect(closeEngagement(id, "back_in_community")).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ ended_how: "back_in_community" });
    expect(onlyEngagement().closed_at).not.toBeNull();

    const closing = data.activities.filter((a) => a.source === "care" && a.activity_type === "care_closed");
    expect(closing).toHaveLength(1);
    expect(closing[0]).toMatchObject({ member_id: ADA, actor_kind: "staff", engagement_value: 0, description: "Back in the community", data: { ended_how: "back_in_community" } });

    await expect(closeEngagement(id, "no_reply")).resolves.toEqual({ error: "That care plan is already closed or gone." });
    expect(data.activities.filter((a) => a.activity_type === "care_closed")).toHaveLength(1);
  });

  it("will not close with 'renewed': only Renew sets that", async () => {
    await expect(closeEngagement(id, "renewed")).resolves.toEqual({ error: "Pick how it ended." });
    expect(onlyEngagement().closed_at).toBeNull();
  });

  it("refuses a close without a real ending", async () => {
    await expect(closeEngagement(id, "vanished")).resolves.toEqual({ error: "Pick how it ended." });
    await expect(closeEngagement("nope", "no_reply")).resolves.toEqual({ error: "That care plan is gone." });
    expect(onlyEngagement().closed_at).toBeNull();
  });

  it("removes an engagement from the list", async () => {
    await expect(deleteEngagement(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement().deleted_at).not.toBeNull();
    await expect(deleteEngagement(id)).resolves.toEqual({ error: "That care plan is gone." });
    await expect(deleteEngagement("nope")).resolves.toEqual({ error: "That care plan is gone." });
  });

  it.each([
    ["logCareMessage", "logMessage", () => logCareMessage(id, "member"), "Couldn't save that."],
    ["updateEngagement", "update", () => updateEngagement(id, { notes: "x" }), "Couldn't save the change."],
    ["closeEngagement", "close", () => closeEngagement(id, "no_reply"), "Couldn't close the care plan."],
    ["deleteEngagement", "softDelete", () => deleteEngagement(id), "Couldn't remove the care plan."],
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
    expect(next).toMatchObject({ member_id: ADA, opened_by: CM_USER.id, renewed_from: id, closed_at: null, owned_by: CM_USER.id, notes: "a plan", reason: "writing_check_in" });
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
    await expect(renewEngagement("nope", "a plan")).resolves.toEqual({ error: "That care plan is gone." });
    await closeEngagement(id, "no_reply");
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ error: expect.stringContaining("already renewed, closed or gone") });
  });

  it("needs a reason, which becomes the new period's note, and keeps the old note on the old period", async () => {
    await expect(renewEngagement(id, "   ")).resolves.toEqual({ error: "Say why you are renewing: what will you do next?" });
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
    await expect(renewEngagement(id, "a plan")).resolves.toEqual({ error: "Couldn't renew the care plan." });
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
      opened_at: OPENED,
      period_ends_on: "2026-03-31",
      renewed_from: null,
      closed_at: null,
      ended_how: null,
      last_staff_message_at: OPENED,
      last_member_message_at: null,
      follow_up_on: null,
      handover_to: null,
      handover_by: null,
      handover_at: null,
      taken_from: null,
      taken_by: null,
      taken_at: null,
      taken_seen_at: null,
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
    await expect(getEngagementResults("nope")).resolves.toEqual({ error: "That care plan is gone." });
    await expect(getEngagementResults("care_ZZZZZZZZZZZZ")).resolves.toEqual({ error: "That care plan is gone." });
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

  it("goes to whoever starts it, never silently to the owner of the member's earlier plan: nobody is given a member's care without agreeing", async () => {
    data.careEngagements.push(
      { ...engagementRow("care_BBBBBBBBBBB1", ADA, "2026-01-01T10:00:00Z"), owned_by: NOT_STAFF, closed_at: "2026-01-20T10:00:00Z", ended_how: "ran_its_course" },
      { ...engagementRow("care_BBBBBBBBBBB2", ADA, "2026-02-01T10:00:00Z"), owned_by: OWNER_B, closed_at: "2026-02-20T10:00:00Z", ended_how: "no_reply" }
    );
    await expect(start()).resolves.toEqual({ success: true });
    expect(data.careEngagements.at(-1)).toMatchObject({ opened_by: CM_USER.id, owned_by: CM_USER.id });
    expect(data.careEngagements.find((c) => c.id === "care_BBBBBBBBBBB2")!.owned_by).toBe(OWNER_B); // the earlier plan keeps its owner
  });
});

describe("loadPreviousCareOwner: who cared for the member before, said on the start form", () => {
  beforeEach(() => signInAs(CM_USER));
  const earlier = (id: string, openedAt: string, over: Record<string, unknown> = {}) =>
    data.careEngagements.push({ ...engagementRow(id, ADA, openedAt), closed_at: "2026-02-20T10:00:00Z", ended_how: "no_reply", ...over });
  const OWNER_B_MEMBER = { id: "mbr_BBBBBBBBBBB1", name: "Olly Example", displayName: "Olly E.", email: "owner-b@example.test", userId: OWNER_B };

  it("names the owner of the member's latest plan with the name the community knows them by, when it is someone else", async () => {
    data.members.push({ ...OWNER_B_MEMBER });
    earlier("care_BBBBBBBBBBB1", "2026-02-01T10:00:00Z", { owned_by: OWNER_B });
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: "Olly E." });
  });

  it("says nothing when it was her, when the plans had no owner, or when there are none", async () => {
    earlier("care_BBBBBBBBBBB1", "2026-02-01T10:00:00Z", { owned_by: CM_USER.id });
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: null });
    data.careEngagements = [];
    earlier("care_BBBBBBBBBBB2", "2026-02-01T10:00:00Z", { owned_by: null });
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: null });
    await expect(loadPreviousCareOwner(BO)).resolves.toEqual({ name: null });
  });

  it("uses a neutral name for an owner with no member record, and ignores a removed plan", async () => {
    earlier("care_BBBBBBBBBBB1", "2026-02-01T10:00:00Z", { owned_by: OWNER_B });
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: "someone else on the team" });
    earlier("care_BBBBBBBBBBB2", "2026-03-01T10:00:00Z", { owned_by: NOT_STAFF, deleted_at: "2026-03-02T10:00:00Z" });
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: "someone else on the team" });
  });

  it("says nothing for something that is not a member id, a signed-out caller, a plain member, or when the read fails", async () => {
    earlier("care_BBBBBBBBBBB1", "2026-02-01T10:00:00Z", { owned_by: OWNER_B });
    await expect(loadPreviousCareOwner("nope")).resolves.toEqual({ name: null });
    await expect(loadPreviousCareOwner(undefined as never)).resolves.toEqual({ name: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "forMember").mockRejectedValueOnce(new Error("connection reset"));
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: null });
    expect(log).toHaveBeenCalledWith("[care] reading the previous owner failed:", "connection reset");
    signInAs(MEMBER_USER);
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: null });
    signInAs(null);
    await expect(loadPreviousCareOwner(ADA)).resolves.toEqual({ name: null });
  });
});

describe("hand-over actions: a care plan changes hands only when the receiver accepts", () => {
  /** Acts as this user: the in-memory repositories answer for whoever is signed in, as the database does from the session. */
  const actAs = (user: { id: string; email?: string | null }) => {
    signInAs(user as never);
    repos = createInMemoryRepos(data, { signedInAs: user.id });
  };
  let id: string;
  beforeEach(async () => {
    actAs(CM_USER);
    await start();
    id = onlyEngagement().id;
  });
  const OWNER_B_USER = { id: OWNER_B, email: "owner-b@example.test" };

  it("offers a plan to another admin or community manager: it keeps its owner until they accept", async () => {
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, handover_to: OWNER_B, handover_by: CM_USER.id });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care/earlier");
    expect(revalidatePath).not.toHaveBeenCalledWith("/admin/care/dms");
  });

  it("changes the owner when the receiver accepts, and clears the offer", async () => {
    await proposeCareHandover(id, OWNER_B);
    actAs(OWNER_B_USER);
    await expect(acceptCareHandover(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: OWNER_B, handover_to: null, handover_by: null, handover_at: null });
  });

  it("lets the receiver decline, and the proposer take it back: the owner stays", async () => {
    await proposeCareHandover(id, OWNER_B);
    actAs(OWNER_B_USER);
    await expect(declineCareHandover(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, handover_to: null });

    actAs(CM_USER);
    await proposeCareHandover(id, OWNER_B);
    await expect(cancelCareHandover(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, handover_to: null });
  });

  it("offers a closed one too", async () => {
    await closeEngagement(id, "ran_its_course");
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ handover_to: OWNER_B, ended_how: "ran_its_course" });
  });

  it("says in the page's words why a step was refused, and changes nothing", async () => {
    await expect(proposeCareHandover(id, NOT_STAFF)).resolves.toEqual({ error: "Pick someone on the team who looks after care plans." });
    await expect(acceptCareHandover(id)).resolves.toEqual({ error: "That hand-over is no longer waiting. Refresh the list." });
    await expect(declineCareHandover(id)).resolves.toEqual({ error: "That hand-over is no longer waiting. Refresh the list." });
    await expect(cancelCareHandover(id)).resolves.toEqual({ error: "That hand-over is no longer waiting. Refresh the list." });
    await expect(claimCarePlan(id)).resolves.toEqual({ error: "Someone owns this care plan now. Refresh the list." });
    await proposeCareHandover(id, OWNER_B);
    await expect(proposeCareHandover(id, ADMIN_B)).resolves.toEqual({ error: "A hand-over is already waiting for an answer." });
    actAs({ id: ADMIN_B });
    await expect(cancelCareHandover(id)).resolves.toEqual({ success: true }); // an admin may take it back, then try to take the plan for themselves
    await expect(proposeCareHandover(id, ADMIN_B)).resolves.toEqual({ error: "Pick someone else. They will be asked to accept it." });
    data.userProfiles.find((p) => p.id === OWNER_B)!.role = "community_manager"; // a colleague who is neither the owner nor an admin
    actAs(OWNER_B_USER);
    await expect(proposeCareHandover(id, ADMIN_B)).resolves.toEqual({ error: "Only the owner, or an admin, can do that." });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, handover_to: null });

    data.careEngagements[0].owned_by = OWNER_B;
    data.careEngagements[0].handover_to = null;
    actAs(OWNER_B_USER);
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ error: "They already own this care plan." });
  });

  it("refuses something that is not an id, and a plan that is gone", async () => {
    await expect(proposeCareHandover(id, "not-a-user")).resolves.toEqual({ error: "Pick who it goes to." });
    await expect(proposeCareHandover(id, undefined as never)).resolves.toEqual({ error: "Pick who it goes to." });
    for (const call of [proposeCareHandover, (plan: string) => acceptCareHandover(plan), declineCareHandover, cancelCareHandover, claimCarePlan] as const) {
      await expect((call as (plan: string, to: string) => Promise<unknown>)("nope", OWNER_B)).resolves.toEqual({ error: "That care plan is gone." });
    }
    await expect(proposeCareHandover("care_ZZZZZZZZZZZZ", OWNER_B)).resolves.toEqual({ error: "That care plan is gone." });
    expect(onlyEngagement().handover_to).toBeNull();
  });

  it("lets a staff member claim a plan nobody owns", async () => {
    data.careEngagements[0].owned_by = null;
    await expect(claimCarePlan(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement().owned_by).toBe(CM_USER.id);
  });

  it("says it could not do it when the database fails, without its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.care, "proposeHandover").mockRejectedValueOnce(new Error("connection reset"));
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ error: "Couldn't do that. Try again." });
    expect(log).toHaveBeenCalledWith("[care] propose a hand-over failed:", "connection reset");
  });

  it("acting for an owner who is gone: an admin offers the plan, a colleague accepts it", async () => {
    actAs(ADMIN_USER);
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, handover_by: ADMIN_USER.id });
    actAs(OWNER_B_USER);
    await expect(acceptCareHandover(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement().owned_by).toBe(OWNER_B);
  });
});

describe("an admin takes a plan over", () => {
  const actAs = (user: { id: string; email?: string | null }) => {
    signInAs(user as never);
    repos = createInMemoryRepos(data, { signedInAs: user.id });
  };
  let id: string;
  beforeEach(async () => {
    actAs(CM_USER);
    await start();
    id = onlyEngagement().id;
  });

  it("takes an open plan from its owner in one step, clears an offer waiting on it, and leaves a notice for the previous owner", async () => {
    await proposeCareHandover(id, OWNER_B);
    actAs(ADMIN_USER);
    await expect(takeOverCarePlan(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement()).toMatchObject({ owned_by: ADMIN_USER.id, handover_to: null, handover_by: null, taken_from: CM_USER.id, taken_by: ADMIN_USER.id, taken_seen_at: null });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/care/earlier");
  });

  it("writes the takeover to the member's timeline with who it was taken from (an account id, no name), and a dismissal writes nothing there", async () => {
    actAs(ADMIN_USER);
    await takeOverCarePlan(id);
    const rows = () => data.activities.filter((a) => a.source === "care" && a.activity_type === "care_plan_taken_over");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ actor_user_id: ADMIN_USER.id, related_id: id, data: { from_user_id: CM_USER.id } });

    const before = data.activities.length;
    actAs(CM_USER);
    await dismissCareTakeoverNotice(id);
    expect(data.activities).toHaveLength(before);
  });

  it("is for admins only: a community manager is refused before anything is asked of the database, and so is an admin previewing one", async () => {
    actAs({ id: OWNER_B, email: "owner-b@example.test" });
    data.userProfiles.find((p) => p.id === OWNER_B)!.role = "community_manager";
    await expect(takeOverCarePlan(id)).resolves.toEqual({ error: "Not authorized" });
    preview.role = "community_manager";
    actAs(ADMIN_USER);
    await expect(takeOverCarePlan(id)).resolves.toEqual({ error: "Not authorized" });
    expect(onlyEngagement()).toMatchObject({ owned_by: CM_USER.id, taken_from: null });
  });

  it("says in the page's words why it was refused: already theirs, closed, gone", async () => {
    actAs(ADMIN_USER);
    await expect(takeOverCarePlan(id)).resolves.toEqual({ success: true });
    await expect(takeOverCarePlan(id)).resolves.toEqual({ error: "You already own this care plan." });
    await expect(takeOverCarePlan("nope")).resolves.toEqual({ error: "That care plan is gone." });

    data.careEngagements[0].owned_by = CM_USER.id;
    data.careEngagements[0].closed_at = "2026-03-05T00:00:00.000Z";
    data.careEngagements[0].ended_how = "ran_its_course";
    await expect(takeOverCarePlan(id)).resolves.toEqual({ error: "That care plan is closed, so it stays with its owner." });
    expect(onlyEngagement().owned_by).toBe(CM_USER.id);
  });

  it("lets only the previous owner dismiss the notice, and tells another person there is nothing to dismiss", async () => {
    actAs(ADMIN_USER);
    await takeOverCarePlan(id);

    await expect(dismissCareTakeoverNotice(id)).resolves.toEqual({ error: "That notice is already gone." }); // the admin who took it
    expect(onlyEngagement().taken_seen_at).toBeNull();

    actAs(CM_USER);
    await expect(dismissCareTakeoverNotice(id)).resolves.toEqual({ success: true });
    expect(onlyEngagement().taken_seen_at).not.toBeNull();
    await expect(dismissCareTakeoverNotice(id)).resolves.toEqual({ success: true }); // a second click
    await expect(dismissCareTakeoverNotice("nope")).resolves.toEqual({ error: "That care plan is gone." });
  });

  it("says it could not do it when the database fails, without its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    actAs(ADMIN_USER);
    vi.spyOn(repos.care, "claim").mockRejectedValueOnce(new Error("connection reset"));
    await expect(takeOverCarePlan(id)).resolves.toEqual({ error: "Couldn't do that. Try again." });
    expect(log).toHaveBeenCalledWith("[care] take a care plan over failed:", "connection reset");
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
        ? [{ member_id: CM_MEMBER, slack_user_id: U.cm, team_id: null, scopes: [...SLACK_DM_SCOPES], connected_at: "2026-01-01T00:00:00.000Z", revoked_at: null, access_secret_id: null, refresh_secret_id: null, expires_at: null, dms_completed_at: null, dms_pulled_at: null, read_pulled_at: null }]
        : [],
      slackChannels: [D.ada, D.bo, D.staff, D.others].map((channel_id) => ({ channel_id, name: "", is_im: true, is_private: true })),
      slackChannelMembers: [...memberships(D.ada, U.cm, U.ada), ...memberships(D.bo, U.bo, U.cm), ...memberships(D.staff, U.cm, U.staff), ...memberships(D.others, U.ada, U.bo)],
      slackMessages: [dmMessage(D.ada, U.ada, new Date(Date.now() + 3600_000).toISOString())],
      featureFlags: bridge ? [{ feature_key: "slack_dm_bridge", enabled_globally: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }] : [],
    });
    repos = createInMemoryRepos(data);
    signInAs(CM_USER);
  }

  /** A care plan of hers (or someone else's) with a member that nothing tracked a DM for: how she gets one without starting it here. */
  const plan = (member: string, over: Record<string, unknown> = {}) =>
    data.careEngagements.push({ ...engagementRow(`care_PLAN${data.careEngagements.length}AAAAAAA`.slice(0, 17), member, "2026-03-01T15:00:00.000Z"), owned_by: CM_USER.id, opened_by: CM_USER.id, ...over });

  describe("starting a care plan", () => {
    it("tracks her DM with that member when she has one, and fills in who spoke last from it", async () => {
      world();
      await expect(start({ memberId: ADA })).resolves.toEqual({ success: true });

      expect(data.careTrackedDms).toHaveLength(1);
      expect(data.careTrackedDms[0]).toMatchObject({ tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA });
      expect(onlyEngagement().last_member_message_at).not.toBeNull();
    });

    it("tracks it whatever the Slack DM bridge says: a DM is only in Bronze for a member whose DMs are pulled", async () => {
      world({ bridge: false });
      await start({ memberId: ADA });
      expect(data.careTrackedDms).toHaveLength(1);
    });

    it("tracks it again when an earlier row of hers was soft deleted: tracking is restored whenever a plan exists", async () => {
      world();
      await start({ memberId: ADA });
      data.careTrackedDms[0].deleted_at = "2026-03-01T00:00:00.000Z"; // what the earlier opt-in design left
      data.careEngagements = [];

      await start({ memberId: ADA });

      expect(data.careTrackedDms.filter((dm) => dm.deleted_at === null)).toHaveLength(1);
    });

    it("tracks nothing when she has no DM with them, or no Slack account connected", async () => {
      world();
      await start({ memberId: NO_DM_MEMBER });
      expect(data.careEngagements).toHaveLength(1);
      expect(data.careTrackedDms).toEqual([]);

      world({ connected: false });
      await start({ memberId: ADA });
      expect(data.careEngagements).toHaveLength(1);
      expect(data.careTrackedDms).toEqual([]);
    });

    it("tracks her own DM for the plan she starts, even when someone else cared for the member before", async () => {
      world();
      plan(ADA, { owned_by: ADMIN_USER.id, opened_by: ADMIN_USER.id, closed_at: "2026-03-05T00:00:00.000Z", ended_how: "ran_its_course" });

      await expect(start({ memberId: ADA })).resolves.toEqual({ success: true });

      expect(data.careEngagements.find((c) => c.closed_at === null)!.owned_by).toBe(CM_USER.id);
      expect(data.careTrackedDms.map((dm) => [dm.tracked_by, dm.member_id])).toEqual([[CM_USER.id, ADA]]);
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
      expect(log).toHaveBeenCalledWith("[care] tracking the DM of a new care plan failed:", "connection reset");
    });
  });

  describe("accepting a hand-over", () => {
    const handedToHer = async () => {
      world();
      // The plan is the admin's; the community manager is offered it and has a DM with Ada.
      plan(ADA, { id: "care_AcceptAAAAAA", owned_by: ADMIN_USER.id, opened_by: ADMIN_USER.id });
      Object.assign(data.careEngagements[0], { handover_to: CM_USER.id, handover_by: ADMIN_USER.id, handover_at: "2026-03-02T10:00:00.000Z" });
      repos = createInMemoryRepos(data, { signedInAs: CM_USER.id });
      signInAs(CM_USER);
    };

    it("tracks the receiver's own DM with the member and fills in who spoke last from it, and the plan is theirs", async () => {
      await handedToHer();
      expect(data.careTrackedDms).toEqual([]);

      await expect(acceptCareHandover(onlyEngagementId())).resolves.toEqual({ success: true });

      expect(onlyEngagement().owned_by).toBe(CM_USER.id);
      expect(data.careTrackedDms.map((dm) => [dm.tracked_by, dm.slack_channel_id, dm.member_id])).toEqual([[CM_USER.id, D.ada, ADA]]);
      expect(onlyEngagement().last_member_message_at).not.toBeNull();
    });

    it("still hands the plan over when tracking the DM fails, and logs only the error", async () => {
      await handedToHer();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.careDms, "track").mockRejectedValueOnce(new Error("connection reset"));

      await expect(acceptCareHandover(onlyEngagementId())).resolves.toEqual({ success: true });

      expect(onlyEngagement().owned_by).toBe(CM_USER.id);
      expect(log).toHaveBeenCalledWith("[care] tracking the DM of a new care plan failed:", "connection reset");
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET_TEXT);
    });

    it("tracks nothing for a closed plan, or when the receiver has no DM with the member", async () => {
      await handedToHer();
      data.careEngagements[0].closed_at = "2026-03-05T00:00:00.000Z";
      data.careEngagements[0].ended_how = "ran_its_course";
      await acceptCareHandover(onlyEngagementId());
      expect(data.careTrackedDms).toEqual([]);

      world();
      plan(NO_DM_MEMBER, { id: "care_AcceptBBBBBB", owned_by: ADMIN_USER.id, opened_by: ADMIN_USER.id });
      Object.assign(data.careEngagements[0], { handover_to: CM_USER.id, handover_by: ADMIN_USER.id, handover_at: "2026-03-02T10:00:00.000Z" });
      repos = createInMemoryRepos(data, { signedInAs: CM_USER.id });
      signInAs(CM_USER);
      await expect(acceptCareHandover(onlyEngagementId())).resolves.toEqual({ success: true });
      expect(data.careTrackedDms).toEqual([]);
    });

    it("an admin taking a plan over tracks their own DM with the member, and who spoke last follows it", async () => {
      world();
      // The admin is the one with the Slack connection and the DM with Ada; the plan is the community manager's.
      data.members.find((m) => m.id === CM_MEMBER)!.userId = ADMIN_USER.id;
      plan(ADA, { id: "care_TakeoverAAAA", owned_by: CM_USER.id, opened_by: CM_USER.id });
      repos = createInMemoryRepos(data, { signedInAs: ADMIN_USER.id });
      signInAs(ADMIN_USER);

      await expect(takeOverCarePlan(onlyEngagementId())).resolves.toEqual({ success: true });

      expect(onlyEngagement()).toMatchObject({ owned_by: ADMIN_USER.id, taken_from: CM_USER.id });
      expect(data.careTrackedDms.map((dm) => [dm.tracked_by, dm.slack_channel_id, dm.member_id])).toEqual([[ADMIN_USER.id, D.ada, ADA]]);
      expect(onlyEngagement().last_member_message_at).not.toBeNull();
    });

    it("claiming a plan nobody owns tracks her DM the same way", async () => {
      world();
      plan(ADA, { id: "care_AcceptCCCCCC", owned_by: null, opened_by: null });
      repos = createInMemoryRepos(data, { signedInAs: CM_USER.id });

      await expect(claimCarePlan(onlyEngagementId())).resolves.toEqual({ success: true });

      expect(onlyEngagement().owned_by).toBe(CM_USER.id);
      expect(data.careTrackedDms.map((dm) => dm.member_id)).toEqual([ADA]);
    });
  });

  describe("backdated care plans and the DMs they pick up", () => {
    useFakeClock(() => Date.parse("2026-03-20T15:00:00Z"));
    const adaWrote = "2026-03-18T14:00:00.000Z";
    const camWrote = "2026-03-18T15:00:00.000Z";

    function worldWithEarlierDms() {
      world();
      // Ada wrote and then Cam wrote back, two days before "now" (nothing today).
      data.slackMessages = [dmMessage(D.ada, U.ada, adaWrote), dmMessage(D.ada, U.cm, camWrote)];
    }

    it("a care plan started today does not count yesterday's DMs", async () => {
      worldWithEarlierDms();
      await start({ memberId: ADA });
      expect(onlyEngagement().last_member_message_at).toBeNull();
    });

    it("a care plan started on the day of those DMs counts them: who spoke last comes from the DM", async () => {
      worldWithEarlierDms();
      await expect(start({ memberId: ADA, startedOn: "2026-03-18" })).resolves.toEqual({ success: true });

      expect(onlyEngagement()).toMatchObject({ opened_at: "2026-03-18T16:00:00.000Z", last_member_message_at: adaWrote, last_staff_message_at: camWrote });
    });

    it("a real reply from that morning is not hidden behind a made-up noon: it replaces the placeholder first message", async () => {
      worldWithEarlierDms();
      data.slackMessages = [dmMessage(D.ada, U.cm, "2026-03-18T13:00:00.000Z"), dmMessage(D.ada, U.ada, "2026-03-18T14:00:00.000Z")]; // she wrote at 9, they replied at 10 (Eastern)

      await start({ memberId: ADA, startedOn: "2026-03-18" });

      expect(onlyEngagement()).toMatchObject({ opened_at: "2026-03-18T16:00:00.000Z", last_staff_message_at: "2026-03-18T13:00:00.000Z", last_member_message_at: "2026-03-18T14:00:00.000Z" });
      expect(Date.parse(onlyEngagement().last_member_message_at!)).toBeGreaterThan(Date.parse(onlyEngagement().last_staff_message_at!)); // so it needs her reply
    });

    it("does not count DMs from before the day it started", async () => {
      worldWithEarlierDms();
      await start({ memberId: ADA, startedOn: "2026-03-19" });
      expect(onlyEngagement().last_member_message_at).toBeNull();
    });

    it("moving the start of an existing care plan earlier picks the earlier DMs up", async () => {
      worldWithEarlierDms();
      await start({ memberId: ADA }); // today: nothing counts yet
      expect(onlyEngagement().last_member_message_at).toBeNull();

      await expect(changeEngagementStart(onlyEngagement().id, "2026-03-18")).resolves.toEqual({ success: true });

      expect(onlyEngagement()).toMatchObject({ last_member_message_at: adaWrote, last_staff_message_at: camWrote });
    });

    it("never reads or logs a word of the messages", async () => {
      worldWithEarlierDms();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await start({ memberId: ADA, startedOn: "2026-03-18" });
      await changeEngagementStart(onlyEngagement().id, "2026-03-17");
      expect(JSON.stringify([log.mock.calls, data.careEngagements, data.careTrackedDms])).not.toContain(SECRET_TEXT);
    });

    it("keeps working when looking at the DMs fails after the start moved", async () => {
      worldWithEarlierDms();
      await start({ memberId: ADA });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(repos.careDms, "forUser").mockRejectedValueOnce(new Error("connection reset"));

      await expect(changeEngagementStart(onlyEngagement().id, "2026-03-18")).resolves.toEqual({ success: true });
      expect(log).toHaveBeenCalledWith("[care] filling in from tracked DMs after a start change failed:", "connection reset");
    });
  });
});

describe("getCareMessages", () => {
  const CM_MEMBER = "mbr_CCCCCCCCCCC1";
  const DM = "D0CMADA01";
  beforeEach(() => {
    data.members.push({ id: CM_MEMBER, name: "Cam Example", email: "cm@example.test", userId: CM_USER.id });
    data.chatSlackAuthors.push({ slack_user_id: "U0ADA", member_id: ADA }, { slack_user_id: "U0CM", member_id: CM_MEMBER });
    data.careEngagements.push({ ...engagementRow("care_AAAAAAAAAAA1", ADA, "2026-03-01T10:00:00.000Z"), opened_by: CM_USER.id, owned_by: CM_USER.id });
    data.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: DM, member_id: ADA, created_at: "2026-03-01T00:00:00.000Z", deleted_at: null });
    data.slackMessages.push(
      { channel_id: DM, message_ts: "1772361600.000100", user_id: "U0CM", occurred_at: "2026-03-01T12:00:00.000Z", text: "Hello, how is the book going?" },
      { channel_id: DM, message_ts: "1772365200.000100", user_id: "U0ADA", occurred_at: "2026-03-01T13:00:00.000Z", text: "Slowly, thank you!" }
    );
  });
  useFakeClock(() => Date.parse("2026-03-20T15:00:00Z"));

  it("gives a community manager the member's plan messages, and puts the read on record first", async () => {
    signInAs(CM_USER);
    const record = vi.spyOn(repos.care, "logMessagesRead");
    const answer = await getCareMessages(ADA);

    expect(record).toHaveBeenCalledWith(ADA);
    if (!("page" in answer)) throw new Error("expected a page");
    expect(answer.page.tracked).toBe(true);
    expect(answer.page.messages.map((m) => [m.author, m.fromMember, m.text])).toEqual([
      ["Ada E.", true, "Slowly, thank you!"],
      ["Cam Example", false, "Hello, how is the book going?"],
    ]);
  });

  it("lets an admin read too", async () => {
    signInAs(ADMIN_USER);
    expect(await getCareMessages(ADA)).toMatchObject({ page: { tracked: true } });
  });

  it("refuses an assistant, a plain member and a signed-out caller, reading nothing", async () => {
    const read = vi.spyOn(repos.slackMessages, "dmMessagesBetween");
    for (const [user, error] of [[ASSISTANT, "Not authorized"], [MEMBER_USER, "Not authorized"], [null, "Not authenticated"]] as const) {
      signInAs(user);
      await expect(getCareMessages(ADA)).resolves.toEqual({ error });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("works for an admin previewing as a community manager (who has the feature), and refuses an id that is not a member's", async () => {
    signInAs(ADMIN_USER);
    preview.role = "community_manager";
    expect(COMMUNITY_MANAGER_FEATURES).toContain("care.write");
    expect(await getCareMessages(ADA)).toMatchObject({ page: expect.anything() });
    await expect(getCareMessages("not-a-member")).resolves.toEqual({ error: "That member isn't available." });
    await expect(getCareMessages("care_AAAAAAAAAAA1")).resolves.toEqual({ error: "That member isn't available." });
  });

  it("shows nothing when the read cannot be put on record, or when no entry applies", async () => {
    signInAs(CM_USER);
    const read = vi.spyOn(repos.slackMessages, "dmMessagesBetween");
    vi.spyOn(repos.care, "logMessagesRead").mockRejectedValueOnce(new Error("audit down"));
    expect(await getCareMessages(ADA)).toEqual({ error: "Couldn't record that you opened these messages, so they are not shown. Try again." });
    vi.spyOn(repos.care, "logMessagesRead").mockResolvedValueOnce(false);
    expect(await getCareMessages(ADA)).toEqual({ error: "Not authorized" });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers an error, not the text, when the messages cannot be loaded", async () => {
    signInAs(CM_USER);
    vi.spyOn(repos.slackMessages, "dmMessagesBetween").mockRejectedValueOnce(new Error("secret text in an error"));
    const answer = await getCareMessages(ADA);
    expect(answer).toEqual({ error: "Couldn't load the messages." });
  });

  it("passes a cursor on, and ignores one that is not text", async () => {
    signInAs(CM_USER);
    const older = await getCareMessages(ADA, "2026-03-01T12:30:00.000Z");
    if (!("page" in older)) throw new Error("expected a page");
    expect(older.page.messages.map((m) => m.text)).toEqual(["Hello, how is the book going?"]);
    expect(await getCareMessages(ADA, 5 as never)).toMatchObject({ page: { messages: expect.any(Array) } });
  });
});

describe("a care plan's events on the member's timeline", () => {
  const actAs = (user: { id: string; email?: string | null }) => {
    signInAs(user as never);
    repos = createInMemoryRepos(data, { signedInAs: user.id });
  };
  const OWNER_B_USER = { id: OWNER_B, email: "owner-b@example.test" };
  const careRows = () => data.activities.filter((a) => a.source === "care");
  const typesOf = () => careRows().map((a) => a.activity_type);
  let id: string;
  beforeEach(async () => {
    actAs(CM_USER);
    await start({ notes: "private words", nextStep: "private step" });
    id = onlyEngagement().id;
  });

  it("writes a row for each hand-over step, as the person who took it, naming only account ids", async () => {
    await proposeCareHandover(id, OWNER_B);
    actAs(OWNER_B_USER);
    await declineCareHandover(id);
    actAs(CM_USER);
    await proposeCareHandover(id, OWNER_B);
    await cancelCareHandover(id);
    await proposeCareHandover(id, OWNER_B);
    actAs(OWNER_B_USER);
    await acceptCareHandover(id);
    data.careEngagements[0].owned_by = null;
    await claimCarePlan(id);

    expect(typesOf()).toEqual([
      "care_started",
      "care_handover_offered",
      "care_handover_declined",
      "care_handover_offered",
      "care_handover_cancelled",
      "care_handover_offered",
      "care_handover_accepted",
      "care_plan_claimed",
    ]);
    const rows = careRows();
    expect(rows[1]).toMatchObject({ actor_kind: "staff", actor_user_id: CM_USER.id, engagement_value: 0, related_id: id, title: "Offered a care plan to a colleague", data: { to_user_id: OWNER_B } });
    expect(rows[2]).toMatchObject({ actor_user_id: OWNER_B, data: { from_user_id: CM_USER.id } }); // declined: whose offer
    expect(rows[4]).toMatchObject({ actor_user_id: CM_USER.id, data: { to_user_id: OWNER_B } }); // taken back: offered to whom
    expect(rows[6]).toMatchObject({ actor_user_id: OWNER_B, data: { from_user_id: CM_USER.id } }); // accepted: from whom
    expect(rows[7].data).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("private");
  });

  it("writes nothing for a hand-over step that was refused", async () => {
    await expect(acceptCareHandover(id)).resolves.toEqual({ error: "That hand-over is no longer waiting. Refresh the list." });
    await expect(proposeCareHandover(id, NOT_STAFF)).resolves.toMatchObject({ error: expect.any(String) });
    expect(typesOf()).toEqual(["care_started"]);
  });

  it("still hands over when the timeline row cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "record").mockRejectedValueOnce(new Error("connection reset"));
    await expect(proposeCareHandover(id, OWNER_B)).resolves.toEqual({ success: true });
    expect(onlyEngagement().handover_to).toBe(OWNER_B);
  });

  it("puts the ending and the plan's number in the data, never what she typed", async () => {
    await renewEngagement(id, "private reason to renew");
    const renewed = careRows().find((a) => a.activity_type === "care_renewed")!;
    expect(renewed.data).toEqual({ plan_number: 2 });
    await closeEngagement(data.careEngagements[1].id, "no_reply");
    const closed = careRows().find((a) => a.activity_type === "care_closed")!;
    expect(closed.data).toEqual({ ended_how: "no_reply" });
    expect(JSON.stringify(careRows())).not.toContain("private");
  });

  it("numbers a third plan as the third", async () => {
    await renewEngagement(id, "again");
    await renewEngagement(data.careEngagements[1].id, "and again");
    expect(careRows().filter((a) => a.activity_type === "care_renewed").map((a) => a.data)).toEqual([{ plan_number: 2 }, { plan_number: 3 }]);
  });
});

describe("loadCarePlanActivity: what the member did during a care plan", () => {
  const fake = useFakeClock(() => Date.parse("2027-03-20T15:00:00Z"));
  const OPENED = "2027-03-01T17:00:00.000Z";
  const STAFF_A = { id: "user-staff-a", email: "a@example.test" };
  let id: string;
  const log = (type: string, at: string, over: Record<string, unknown> = {}) =>
    repos.activities.record({ memberId: ADA, type, category: "event", title: type, occurredAt: at, source: "prickle_attendance", relatedId: `rel-${type}-${at}`, actorKind: "member", ...over });
  beforeEach(async () => {
    signInAs(CM_USER);
    repos = createInMemoryRepos(data, { signedInAs: CM_USER.id });
    data.members.push({ id: "mbr_AAAAAAAAAAA3", name: "Cam & <Mgr>", email: "cam@example.test", userId: CM_USER.id } as never);
    await start({ startedOn: "2027-03-01" });
    id = onlyEngagement().id;
    data.careEngagements[0].opened_at = OPENED;
  });

  it("lists the plan's window, newest first, with the plan's own moments named by the staff member who did them", async () => {
    await log("prickle_attended", "2027-03-05T15:00:00Z", { title: "Attended Morning Writing" });
    await log("slack_message", "2027-03-06T15:00:00Z", { source: "slack", title: "Posted in #writing", description: "the words she wrote" });
    await log("prickle_attended", "2027-02-20T15:00:00Z", { title: "Before the plan" });
    // The started row is at the opening; make its time the plan's.
    careStartedRow().occurred_at = OPENED;

    const answer = await loadCarePlanActivity(id);

    expect("items" in answer).toBe(true);
    if (!("items" in answer)) return;
    expect(answer.items.map((i) => i.label)).toEqual(["Posted in #writing", "Attended Morning Writing", "Cam & <Mgr> started a care plan"]);
    expect(answer.items.map((i) => i.care)).toEqual([false, false, true]);
    expect(answer).toMatchObject({ total: 3, page: 1, open: true, fromIso: OPENED, toIso: "2027-03-20T15:00:00.000Z" });
    expect(JSON.stringify(answer)).not.toContain("the words she wrote");
  });

  const careStartedRow = () => data.activities.find((a) => a.activity_type === "care_started")!;

  it("ends an open plan's window at now, not including it, and a closed plan's at its close", async () => {
    await log("prickle_attended", "2027-03-20T15:00:00Z", { title: "Right now" });
    await log("prickle_attended", "2027-03-20T14:59:59Z", { title: "A second ago" });
    let answer = await loadCarePlanActivity(id);
    if (!("items" in answer)) throw new Error("expected a list");
    expect(answer.items.map((i) => i.label)).toContain("A second ago");
    expect(answer.items.map((i) => i.label)).not.toContain("Right now");

    await closeEngagement(id, "ran_its_course");
    const closedAt = data.careEngagements[0].closed_at!;
    await log("prickle_attended", closedAt, { title: "At the close" });
    await log("prickle_attended", "2027-03-10T15:00:00Z", { title: "While it ran" });
    answer = await loadCarePlanActivity(id);
    if (!("items" in answer)) throw new Error("expected a list");
    expect(answer.open).toBe(false);
    expect(answer.toIso).toBe(new Date(closedAt).toISOString());
    const labels = answer.items.map((i) => i.label);
    expect(labels).toContain("While it ran");
    expect(labels).not.toContain("At the close");
    expect(labels).toContain("Cam & <Mgr> closed the care plan: ran its course"); // its own row stays, though it is at the end
  });

  it("gives each plan its own window: an earlier plan lists its own stretch", async () => {
    await log("prickle_attended", "2027-03-05T15:00:00Z", { title: "In the first plan" });
    fake.clock.advance(-10 * 86_400_000); // the renewal is on March 10
    await renewEngagement(id, "keep going");
    fake.clock.advance(10 * 86_400_000);
    await log("prickle_attended", "2027-03-15T15:00:00Z", { title: "In the second plan" });
    // The renewal closed the first at the renewal's instant.
    const [first, second] = data.careEngagements;
    first.opened_at = OPENED;
    const one = await loadCarePlanActivity(first.id);
    const two = await loadCarePlanActivity(second.id);
    if (!("items" in one) || !("items" in two)) throw new Error("expected lists");
    expect(one.items.map((i) => i.label)).toContain("In the first plan");
    expect(one.items.map((i) => i.label)).not.toContain("In the second plan");
    expect(two.items.map((i) => i.label)).toContain("In the second plan");
    expect(two.items.map((i) => i.label)).not.toContain("In the first plan");
    expect(two.items.map((i) => i.label)).toContain("Cam & <Mgr> renewed the care plan (second plan)");
  });

  it("names hand-over steps with the colleague's display name, as the community knows them", async () => {
    data.members.push({ id: "mbr_AAAAAAAAAAA4", name: "Legal Owner", displayName: "Bee & <Owner>", email: "b@example.test", userId: OWNER_B } as never);
    await proposeCareHandover(id, OWNER_B);
    const answer = await loadCarePlanActivity(id);
    if (!("items" in answer)) throw new Error("expected a list");
    expect(answer.items[0].label).toBe("Cam & <Mgr> offered the care plan to Bee & <Owner>");
  });

  it("pages, a page at a time, and clamps a page past the end", async () => {
    for (let i = 0; i < 30; i += 1) await log("slack_reaction", new Date(Date.parse("2027-03-02T12:00:00Z") + i * 60_000).toISOString(), { source: "slack", title: `Reacted ${i}` });
    const first = await loadCarePlanActivity(id, 1);
    const second = await loadCarePlanActivity(id, 2);
    const beyond = await loadCarePlanActivity(id, 99);
    if (!("items" in first) || !("items" in second) || !("items" in beyond)) throw new Error("expected lists");
    expect(first).toMatchObject({ total: 31, page: 1, pageSize: 25 });
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(6);
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(31);
    expect(beyond.page).toBe(2);
    await expect(loadCarePlanActivity(id, -3)).resolves.toMatchObject({ page: 1 });
  });

  it("is for admins and the community manager: not an assistant, not a plain member, not someone signed out", async () => {
    data.userProfiles.push({ id: STAFF_A.id, email: STAFF_A.email, role: "assistant" });
    signInAs(STAFF_A);
    await expect(loadCarePlanActivity(id)).resolves.toEqual({ error: "Not authorized" });
    signInAs(MEMBER_USER);
    await expect(loadCarePlanActivity(id)).resolves.toEqual({ error: "Not authorized" });
    signInAs(null);
    await expect(loadCarePlanActivity(id)).resolves.toEqual({ error: "Not authenticated" });
    signInAs(ADMIN_USER);
    await expect(loadCarePlanActivity(id)).resolves.toMatchObject({ total: expect.any(Number) });
  });

  it("refuses something that is not a care plan id and a plan that is gone, and says it could not load when a read fails, without the message", async () => {
    await expect(loadCarePlanActivity("nope")).resolves.toEqual({ error: "That care plan is gone." });
    await expect(loadCarePlanActivity("care_ZZZZZZZZZZZZ")).resolves.toEqual({ error: "That care plan is gone." });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.activities, "planActivity").mockRejectedValueOnce(new Error("connection reset"));
    await expect(loadCarePlanActivity(id)).resolves.toEqual({ error: "Couldn't load the activity." });
  });

  it("says a staff member with no member record as a staff member", async () => {
    data.members = data.members.filter((m) => m.userId !== CM_USER.id);
    const answer = await loadCarePlanActivity(id);
    if (!("items" in answer)) throw new Error("expected a list");
    expect(answer.items.at(-1)?.label).toBe("A staff member started a care plan");
  });
});
