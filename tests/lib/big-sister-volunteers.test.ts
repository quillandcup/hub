import { describe, expect, it } from "vitest";
import { getHostEligibility } from "@/lib/host-eligibility";
import {
  getVolunteerEligibility,
  rankVolunteers,
  volunteerEligibilityMessage,
} from "@/lib/big-sister-volunteers";
import type { MentorshipRow } from "@/lib/mentorship";

const NOW = new Date("2026-10-14T16:00:00Z");

describe("getVolunteerEligibility", () => {
  it("is exactly the hosting rule: a full month since they first joined", () => {
    for (const firstJoinedAt of ["2026-09-14", "2026-09-15", "2024-01-01", null]) {
      const member = { firstJoinedAt, mostRecentJoinedAt: null };
      expect(getVolunteerEligibility(member, NOW).eligible).toBe(getHostEligibility(member, NOW).eligible);
    }
  });

  it("lets a returning member volunteer: the month counts from their first join", () => {
    expect(getVolunteerEligibility({ firstJoinedAt: "2023-02-01", mostRecentJoinedAt: "2026-10-10" }, NOW)).toEqual({
      eligible: true,
    });
  });

  it("says when a new member can volunteer", () => {
    const result = getVolunteerEligibility({ firstJoinedAt: "2026-10-01", mostRecentJoinedAt: null }, NOW);
    expect(result).toEqual({ eligible: false, eligibleOn: "2026-11-01" });
    if (!result.eligible) expect(volunteerEligibilityMessage(result)).toBe(
      "You can volunteer once you've been a member for a full month: from November 1, 2026."
    );
  });

  it("can't volunteer without a join date on record", () => {
    expect(getVolunteerEligibility({ firstJoinedAt: null, mostRecentJoinedAt: null }, NOW).eligible).toBe(false);
  });
});

function match(mentorMemberId: string, startedOn: string, active: boolean): MentorshipRow {
  return {
    id: `${mentorMemberId}-${startedOn}`,
    mentorMemberId,
    mentorName: mentorMemberId,
    newMemberId: `n-${startedOn}`,
    newMemberName: "N",
    startedOn,
    trialEndsOn: null,
    kind: "trial",
    status: "matched",
    active,
    outcomeNote: null,
    outcome: "converted",
    convertedOn: null,
    currentMember: false,
  };
}

describe("rankVolunteers", () => {
  const v = (memberId: string, volunteeredAt = "2026-01-01T00:00:00Z") => ({
    memberId,
    name: memberId,
    note: null,
    volunteeredAt,
  });

  it("puts whoever has no new member right now first, then whoever has waited longest", () => {
    const ranked = rankVolunteers(
      [v("busy"), v("recent"), v("longAgo"), v("never")],
      [
        match("busy", "2026-10-10", true),
        match("recent", "2026-09-01", false),
        match("longAgo", "2026-02-01", false),
      ]
    );
    expect(ranked.map((r) => r.memberId)).toEqual(["never", "longAgo", "recent", "busy"]);
    expect(ranked[3]).toMatchObject({ openLoad: 1, totalMatches: 1, lastStartedOn: "2026-10-10" });
  });

  it("breaks ties between never-matched volunteers by who volunteered first", () => {
    const ranked = rankVolunteers([v("late", "2026-05-01T00:00:00Z"), v("early", "2026-02-01T00:00:00Z")], []);
    expect(ranked.map((r) => r.memberId)).toEqual(["early", "late"]);
  });

  it("ignores reassigned matches", () => {
    const reassigned = { ...match("a", "2026-10-01", true), status: "reassigned" as const };
    expect(rankVolunteers([v("a")], [reassigned])[0]).toMatchObject({ openLoad: 0, totalMatches: 0 });
  });
});
