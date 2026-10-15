import { describe, expect, it } from "vitest";
import {
  BILLING_GRACE_DAYS,
  CONVERSION_WINDOW_DAYS,
  MENTORSHIP_DAYS,
  computeMentorStats,
  computeOverallStats,
  computePeriodStats,
  deriveOutcome,
  isMentorshipActive,
  mentorshipEndsOn,
  openLoadByMentor,
  parseMatchInput,
  toMentorshipRows,
  todayKey,
  type MentorshipRow,
} from "@/lib/mentorship";

const NEW_MEMBER = { status: "active", firstJoinedAt: "2026-03-20", mostRecentJoinedAt: "2026-03-20" };
const LEAD = { status: "lead", firstJoinedAt: null, mostRecentJoinedAt: null };

function addDays(dateOnly: string, days: number): string {
  return todayKey(new Date(Date.parse(`${dateOnly}T00:00:00Z`) + days * 86_400_000));
}

describe("the 30-day mentorship", () => {
  it("lasts 30 days from the day the membership began", () => {
    expect(MENTORSHIP_DAYS).toBe(30);
    expect(mentorshipEndsOn("2026-03-01")).toBe("2026-03-30");
    expect(isMentorshipActive("2026-03-01", "2026-03-30")).toBe(true);
    expect(isMentorshipActive("2026-03-01", "2026-03-31")).toBe(false);
  });
});

describe("deriveOutcome for a trial", () => {
  it("is converted when a membership began after the trial started", () => {
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-08", NEW_MEMBER, "2026-06-01")).toEqual({
      outcome: "converted",
      convertedOn: "2026-03-20",
      currentMember: true,
    });
  });

  it("reports whether a converted member is a current member", () => {
    expect(deriveOutcome("trial", "2026-03-01", null, { ...NEW_MEMBER, status: "cancelled" }, "2026-06-01").currentMember).toBe(false);
    expect(deriveOutcome("trial", "2026-03-01", null, { ...NEW_MEMBER, status: "on_hiatus" }, "2026-06-01").currentMember).toBe(true);
  });

  it("is in trial until the trial's end plus the billing grace, using the stored trial end", () => {
    const endsOn = "2026-03-08";
    expect(deriveOutcome("trial", "2026-03-01", endsOn, LEAD, addDays(endsOn, BILLING_GRACE_DAYS - 1)).outcome).toBe("in_trial");
    expect(deriveOutcome("trial", "2026-03-01", endsOn, LEAD, addDays(endsOn, BILLING_GRACE_DAYS)).outcome).toBe("not_converted");
  });

  it("waits out a month-long trial", () => {
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-31", LEAD, "2026-03-20").outcome).toBe("in_trial");
  });

  it("never assumes a trial length: with no end on record only the grace after the start applies", () => {
    expect(deriveOutcome("trial", "2026-03-01", null, LEAD, addDays("2026-03-01", BILLING_GRACE_DAYS - 1)).outcome).toBe("in_trial");
    expect(deriveOutcome("trial", "2026-03-01", null, LEAD, addDays("2026-03-01", BILLING_GRACE_DAYS)).outcome).toBe("not_converted");
  });

  it("treats a missing member like a trial that hasn't produced a membership", () => {
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-08", null, "2026-09-01").outcome).toBe("not_converted");
  });

  it("ignores a membership that began long before the trial (a returning member's old stint)", () => {
    const returning = { status: "cancelled", firstJoinedAt: "2023-01-10", mostRecentJoinedAt: "2023-01-10" };
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-08", returning, "2026-09-01").outcome).toBe("not_converted");
  });

  it("uses a returning member's most recent join when it falls in the trial window", () => {
    const returning = { status: "active", firstJoinedAt: "2023-01-10", mostRecentJoinedAt: "2026-03-25" };
    const result = deriveOutcome("trial", "2026-03-01", "2026-03-08", returning, "2026-09-01");
    expect(result.outcome).toBe("converted");
    expect(result.convertedOn).toBe("2026-03-25");
  });

  it("ignores a membership that began long after the trial ended (coming back on their own)", () => {
    const joined = addDays("2026-03-01", CONVERSION_WINDOW_DAYS + 1);
    const late = { status: "active", firstJoinedAt: joined, mostRecentJoinedAt: joined };
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-08", late, "2027-03-01").outcome).toBe("not_converted");
  });

  it("allows a membership dated a few days before the recorded start", () => {
    const early = { status: "active", firstJoinedAt: "2026-02-26", mostRecentJoinedAt: "2026-02-26" };
    expect(deriveOutcome("trial", "2026-03-01", "2026-03-08", early, "2026-06-01").outcome).toBe("converted");
  });
});

describe("deriveOutcome for everyone else", () => {
  it.each(["direct", "program"] as const)("has no trial outcome to track for a %s arrival", (kind) => {
    expect(deriveOutcome(kind, "2026-03-01", null, LEAD, "2026-09-01")).toEqual({
      outcome: "no_trial",
      convertedOn: null,
      currentMember: false,
    });
    expect(deriveOutcome(kind, "2026-03-01", null, NEW_MEMBER, "2026-09-01").currentMember).toBe(true);
  });
});

function row(overrides: Partial<MentorshipRow>): MentorshipRow {
  return {
    id: "m",
    mentorMemberId: "mentor-a",
    mentorName: "Alice",
    newMemberId: "new",
    newMemberName: "New",
    startedOn: "2026-01-15",
    trialEndsOn: null,
    kind: "trial",
    status: "matched",
    active: false,
    outcomeNote: null,
    outcome: "converted",
    convertedOn: null,
    currentMember: false,
    ...overrides,
  };
}

describe("mentor and period stats", () => {
  const rows = [
    row({ id: "1", outcome: "converted", currentMember: true }),
    row({ id: "2", outcome: "not_converted", startedOn: "2026-02-10" }),
    row({ id: "3", outcome: "in_trial", startedOn: "2026-04-02", active: true }),
    row({ id: "4", mentorMemberId: "mentor-b", mentorName: "Bea", outcome: "converted", startedOn: "2026-05-01" }),
    row({ id: "5", status: "reassigned", outcome: "not_converted" }),
    row({ id: "6", mentorMemberId: "mentor-b", mentorName: "Bea", kind: "direct", outcome: "no_trial", startedOn: "2026-05-10", active: true }),
  ];

  it("counts per big sister and keeps non-trial arrivals and in-progress trials out of the rate", () => {
    const [alice, bea] = computeMentorStats(rows);
    expect(alice).toMatchObject({
      mentorName: "Alice",
      total: 3,
      converted: 1,
      notConverted: 1,
      inTrial: 1,
      noTrial: 0,
      currentMembers: 1,
      conversionRate: 0.5,
      lastStartedOn: "2026-04-02",
    });
    expect(bea).toMatchObject({ mentorName: "Bea", total: 2, converted: 1, noTrial: 1, conversionRate: 1 });
  });

  it("has no rate until a trial is decided", () => {
    const [only] = computeMentorStats([row({ outcome: "in_trial" })]);
    expect(only.conversionRate).toBeNull();
  });

  it("never counts a reassigned match", () => {
    expect(computeOverallStats(rows)).toMatchObject({ total: 5, noTrial: 1, conversionRate: 2 / 3 });
  });

  it("groups by the quarter the membership began, oldest first", () => {
    expect(computePeriodStats(rows).map((p) => [p.period, p.total, p.converted])).toEqual([
      ["2026-Q1", 2, 1],
      ["2026-Q2", 3, 1],
    ]);
  });

  it("flags big sisters whose new member is still inside their 30 days", () => {
    expect(Object.fromEntries(openLoadByMentor(rows))).toEqual({ "mentor-a": 1, "mentor-b": 1 });
  });
});

describe("toMentorshipRows", () => {
  it("joins names, derives the outcome and whether the 30 days are still running", () => {
    const [result] = toMentorshipRows(
      [
        {
          id: "x",
          mentor_member_id: "m1",
          new_member_id: "t1",
          started_on: "2026-03-01",
          trial_ends_on: "2026-03-08",
          kind: "trial",
          status: "matched",
          outcome_note: "note",
          mentor: { id: "m1", name: "Alice", status: "active", first_joined_at: null, most_recent_joined_at: null },
          new_member: [
            { id: "t1", name: "Tess", status: "active", first_joined_at: "2026-03-20", most_recent_joined_at: "2026-03-20" },
          ],
        },
      ],
      "2026-03-15"
    );
    expect(result).toMatchObject({
      mentorName: "Alice",
      newMemberName: "Tess",
      outcome: "converted",
      outcomeNote: "note",
      active: true,
      kind: "trial",
    });
  });
});

describe("parseMatchInput", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("accepts two different members", () => {
    expect(parseMatchInput({ mentorMemberId: A, newMemberId: B })).toEqual({
      ok: true,
      value: { mentorMemberId: A, newMemberId: B },
    });
  });

  it.each([
    [{ mentorMemberId: null, newMemberId: B }, "Choose a big sister."],
    [{ mentorMemberId: A, newMemberId: null }, "Choose a new member."],
    [{ mentorMemberId: A, newMemberId: A }, "A member can't be their own big sister."],
  ])("rejects %j", (input, error) => {
    expect(parseMatchInput(input)).toEqual({ ok: false, error });
  });
});
