import { describe, expect, it } from "vitest";
import { CARE_MESSAGES_PAGE, loadCareMessages, planOf, planWindow, plainSlackText } from "@/lib/care-messages";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Row } from "@/lib/data/db";

// Fake people. A and B are two staff members (community manager and admin), each with a member profile and a Slack account; ADA and BO are members.
const A_USER = "11111111-1111-4111-8111-111111111111";
const B_USER = "22222222-2222-4222-8222-222222222222";
const C_USER = "33333333-3333-4333-8333-333333333333";
const A = "mbr_AAAAAAAAAAA1";
const B = "mbr_AAAAAAAAAAA2";
const C = "mbr_AAAAAAAAAAA3";
const ADA = "mbr_BBBBBBBBBBB1";
const BO = "mbr_BBBBBBBBBBB2";
const SLACK = { a: "U0A", b: "U0B", c: "U0C", ada: "U0ADA", bo: "U0BO" };
const DM_A_ADA = "D0AADA";
const DM_B_ADA = "D0BADA";
const DM_C_ADA = "D0CADA";
const DM_A_BO = "D0ABO";
const NOW = new Date("2026-11-20T12:00:00.000Z");

let seq = 0;
const plan = (over: Partial<Row<"care_engagements">> & { member_id: string; opened_at: string }): Row<"care_engagements"> => ({
  id: `care_${String(++seq).padStart(12, "A")}`,
  reason: "introduction",
  channel: "slack_dm",
  opened_by: A_USER,
  owned_by: A_USER,
  closed_at: null,
  period_ends_on: "2026-12-31",
  last_staff_message_at: null,
  last_member_message_at: null,
  notes: null,
  next_step: null,
  follow_up_on: null,
  ended_how: null,
  renewed_from: null,
  created_at: over.opened_at,
  updated_at: over.opened_at,
  deleted_at: null,
  ...over,
});
const tracked = (tracked_by: string, slack_channel_id: string, member_id: string, deleted_at: string | null = null): Row<"care_tracked_dms"> => ({
  id: `caredm_${String(++seq).padStart(12, "A")}`,
  tracked_by,
  slack_channel_id,
  member_id,
  created_at: "2026-10-01T00:00:00.000Z",
  deleted_at,
});
const say = (channel_id: string, user_id: string, occurred_at: string, text: string, extra: Record<string, unknown> = {}) => ({
  channel_id,
  message_ts: `${Date.parse(occurred_at) / 1000}.${String(++seq).padStart(6, "0")}`,
  user_id,
  occurred_at,
  text,
  ...extra,
});

function repos(over: { plans: Row<"care_engagements">[]; tracking: Row<"care_tracked_dms">[]; messages: ReturnType<typeof say>[] }) {
  return createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: A, name: "Cam Example", displayName: "Cam", email: "a@example.test", userId: A_USER },
        { id: B, name: "Bea Example", email: "b@example.test", userId: B_USER },
        { id: C, name: "Cy Example", email: "c@example.test", userId: C_USER },
        { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
        { id: BO, name: "Bo Example", email: "bo@example.test" },
      ],
      chatSlackAuthors: [
        { slack_user_id: SLACK.a, member_id: A },
        { slack_user_id: SLACK.b, member_id: B },
        { slack_user_id: SLACK.c, member_id: C },
        { slack_user_id: SLACK.ada, member_id: ADA },
        { slack_user_id: SLACK.bo, member_id: BO },
      ],
      careEngagements: over.plans,
      careTrackedDms: over.tracking,
      slackMessages: over.messages as never,
    })
  );
}

describe("a plan's window", () => {
  it("runs from its start to its close, or to now while it is open; the end is not included", () => {
    expect(planWindow({ opened_at: "2026-11-01T10:00:00Z", closed_at: "2026-11-10T10:00:00Z" }, NOW)).toEqual({ from: "2026-11-01T10:00:00.000Z", to: "2026-11-10T10:00:00.000Z" });
    expect(planWindow({ opened_at: "2026-11-01T10:00:00Z", closed_at: null }, NOW).to).toBe(NOW.toISOString());

    const older = plan({ member_id: ADA, opened_at: "2026-11-01T10:00:00Z", closed_at: "2026-11-10T10:00:00Z" });
    const newer = plan({ member_id: ADA, opened_at: "2026-11-10T10:00:00Z" });
    const windows = [newer, older].map((p) => ({ plan: p, ...planWindow(p, NOW) }));
    // The instant one plan closes and the next opens belongs to the next; before the first start and in a gap belongs to none.
    expect(planOf(windows, "2026-11-10T10:00:00Z")?.id).toBe(newer.id);
    expect(planOf(windows, "2026-11-10T09:59:59Z")?.id).toBe(older.id);
    expect(planOf(windows, "2026-11-01T10:00:00Z")?.id).toBe(older.id);
    expect(planOf(windows, "2026-10-31T23:00:00Z")).toBeNull();
  });
});

describe("plainSlackText", () => {
  it("decodes Slack's escapes and turns mentions into a name, without shortening", () => {
    expect(plainSlackText("a &amp; b &lt;c&gt; <@U123> hi")).toBe("a & b <c> @someone hi");
    const long = "word ".repeat(2000);
    expect(plainSlackText(long)).toBe(long);
  });
});

describe("loadCareMessages", () => {
  const first = plan({ member_id: ADA, opened_at: "2026-11-01T10:00:00Z", closed_at: "2026-11-10T10:00:00Z", ended_how: "renewed" });
  const second = plan({ member_id: ADA, opened_at: "2026-11-10T10:00:00Z", renewed_from: first.id });

  it("reads nothing, and says so, when no DM with the member is tracked for one of their plans", async () => {
    const page = await loadCareMessages(repos({ plans: [first], tracking: [], messages: [say(DM_A_ADA, SLACK.ada, "2026-11-02T10:00:00Z", "hello")] }), ADA, { now: NOW });
    expect(page).toMatchObject({ tracked: false, messages: [], olderBefore: null });
    expect(page.plans.map((p) => p.id)).toEqual([first.id]);
    // A DM tracked by someone who owns none of the member's plans is not one either.
    const other = await loadCareMessages(repos({ plans: [first], tracking: [tracked(B_USER, DM_B_ADA, ADA)], messages: [say(DM_B_ADA, SLACK.ada, "2026-11-02T10:00:00Z", "hello")] }), ADA, { now: NOW });
    expect(other.tracked).toBe(false);
    expect(other.messages).toEqual([]);
  });

  it("shows the full messages sent inside each plan's window, grouped by plan, who and when; nothing before, after or between", async () => {
    const long = `${"a long message ".repeat(60)}with &amp; and a second\nline`;
    const page = await loadCareMessages(
      repos({
        plans: [second, first],
        tracking: [tracked(A_USER, DM_A_ADA, ADA)],
        messages: [
          say(DM_A_ADA, SLACK.a, "2026-10-31T10:00:00Z", "before any plan"),
          say(DM_A_ADA, SLACK.a, "2026-11-02T10:00:00Z", long),
          say(DM_A_ADA, SLACK.ada, "2026-11-03T10:00:00Z", "an answer", { files: [{ id: "F1" }] }),
          say(DM_A_ADA, SLACK.a, "2026-11-04T10:00:00Z", "deleted", { deleted_at: "2026-11-05T00:00:00Z" }),
          say(DM_A_ADA, SLACK.a, "2026-11-04T11:00:00Z", "joined", { message_type: "channel_join" }),
          say(DM_A_ADA, SLACK.a, "2026-11-10T10:00:00Z", "first of the second plan"),
          say(DM_A_ADA, SLACK.ada, "2026-11-19T10:00:00Z", "still open"),
          say(DM_A_ADA, SLACK.a, "2026-11-21T10:00:00Z", "in the future of this test"),
          say(DM_A_BO, SLACK.bo, "2026-11-03T10:00:00Z", "another member's DM"),
        ],
      }),
      ADA,
      { now: NOW }
    );

    expect(page.tracked).toBe(true);
    expect(page.plans.map((p) => [p.id, p.closedAt, p.ownerName])).toEqual([
      [second.id, null, "Cam"],
      [first.id, "2026-11-10T10:00:00.000Z", "Cam"],
    ]);
    expect(page.messages.map((m) => [m.planId === second.id ? "second" : "first", m.author, m.fromMember, m.text.slice(0, 20), m.hasFiles])).toEqual([
      ["second", "Ada E.", true, "still open", false],
      ["second", "Cam", false, "first of the second ", false],
      ["first", "Ada E.", true, "an answer", true],
      ["first", "Cam", false, "a long message a lon", false],
    ]);
    expect(page.messages[3].text).toBe(long.replace("&amp;", "&"));
    expect(page.messages.map((m) => m.text)).not.toContain("another member's DM");
    expect(page.olderBefore).toBeNull();
  });

  it("is per member, across plans and owners: a later owner reads the earlier plan's messages, and a reassigned plan keeps them", async () => {
    // The first plan was owned by A, who tracks the DM; the second (open) was handed to B, who tracks nothing yet.
    const handed = plan({ ...second, owned_by: B_USER, opened_by: A_USER });
    const page = await loadCareMessages(
      repos({
        plans: [handed, first],
        tracking: [tracked(A_USER, DM_A_ADA, ADA)],
        messages: [say(DM_A_ADA, SLACK.a, "2026-11-02T10:00:00Z", "early"), say(DM_A_ADA, SLACK.a, "2026-11-12T10:00:00Z", "after the hand-over")],
      }),
      ADA,
      { now: NOW }
    );
    // A still owns the first plan, so her tracked DM is read for both plans' windows; the new owner B is named on the second.
    expect(page.messages.map((m) => m.text)).toEqual(["after the hand-over", "early"]);
    expect(page.plans.map((p) => p.ownerName)).toEqual(["Bea Example", "Cam"]);

    // Once B tracks her own DM with the member, hers is read as well (a different conversation).
    const both = await loadCareMessages(
      repos({
        plans: [handed, first],
        tracking: [tracked(A_USER, DM_A_ADA, ADA), tracked(B_USER, DM_B_ADA, ADA)],
        messages: [say(DM_A_ADA, SLACK.a, "2026-11-02T10:00:00Z", "early"), say(DM_B_ADA, SLACK.b, "2026-11-13T10:00:00Z", "from the new owner"), say(DM_B_ADA, SLACK.ada, "2026-11-13T11:00:00Z", "reply")],
      }),
      ADA,
      { now: NOW }
    );
    expect(both.messages.map((m) => [m.author, m.text])).toEqual([["Ada E.", "reply"], ["Bea Example", "from the new owner"], ["Cam", "early"]]);
  });

  it("reads only DMs tracked by an owner of one of the member's plans, never a staff member's other tracking, an untracked DM or a removed plan", async () => {
    const removed = plan({ member_id: ADA, opened_at: "2026-11-05T10:00:00Z", closed_at: "2026-11-08T10:00:00Z", owned_by: C_USER, opened_by: C_USER, deleted_at: "2026-11-09T00:00:00Z" });
    const page = await loadCareMessages(
      repos({
        plans: [first, removed],
        tracking: [tracked(A_USER, DM_A_ADA, ADA), tracked(B_USER, DM_B_ADA, ADA), tracked(C_USER, DM_C_ADA, ADA), tracked(A_USER, DM_A_BO, BO), tracked(A_USER, "D0GONE", ADA, "2026-11-08T00:00:00Z")],
        messages: [
          say(DM_A_ADA, SLACK.a, "2026-11-02T10:00:00Z", "mine"),
          say(DM_B_ADA, SLACK.b, "2026-11-02T11:00:00Z", "B owns none of the plans"),
          say(DM_C_ADA, SLACK.c, "2026-11-06T10:00:00Z", "C owned only a removed plan"),
          say(DM_A_BO, SLACK.bo, "2026-11-02T12:00:00Z", "Bo's"),
          say("D0GONE", SLACK.a, "2026-11-02T13:00:00Z", "no longer tracked"),
        ],
      }),
      ADA,
      { now: NOW }
    );
    expect(page.messages.map((m) => m.text)).toEqual(["mine"]);
  });

  it("pages newest first, a page at a time, without repeating or missing a message", async () => {
    const messages = Array.from({ length: 120 }, (_, i) => say(DM_A_ADA, i % 2 ? SLACK.ada : SLACK.a, new Date(Date.parse("2026-11-12T10:00:00Z") + i * 60_000).toISOString(), `message ${i}`));
    const r = repos({ plans: [second, first], tracking: [tracked(A_USER, DM_A_ADA, ADA)], messages });

    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const page = await loadCareMessages(r, ADA, { now: NOW, before });
      expect(page.messages.length).toBeLessThanOrEqual(CARE_MESSAGES_PAGE);
      seen.push(...page.messages.map((m) => m.text));
      before = page.olderBefore;
      pages++;
    } while (before && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => `message ${119 - i}`));
    // A cursor that is not a time is ignored.
    expect((await loadCareMessages(r, ADA, { now: NOW, before: "nonsense" })).messages).toHaveLength(CARE_MESSAGES_PAGE);
  });

  it("names someone from the team when a staff member's profile is gone", async () => {
    const orphan = plan({ member_id: ADA, opened_at: "2026-11-01T10:00:00Z", owned_by: "99999999-9999-4999-8999-999999999999", opened_by: "99999999-9999-4999-8999-999999999999" });
    const page = await loadCareMessages(
      repos({ plans: [orphan], tracking: [tracked("99999999-9999-4999-8999-999999999999", DM_A_ADA, ADA)], messages: [say(DM_A_ADA, SLACK.a, "2026-11-02T10:00:00Z", "hi")] }),
      ADA,
      { now: NOW }
    );
    expect(page.messages[0].author).toBe("Someone from the team");
    expect(page.plans[0].ownerName).toBe("Someone from the team");
  });
});
