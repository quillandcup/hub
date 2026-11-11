import { describe, expect, it } from "vitest";
import { careAttention } from "@/app/(admin)/admin/care/attention";
import type { EngagementCardData } from "@/app/(admin)/admin/care/card";

const card = (over: Partial<EngagementCardData>): EngagementCardData => ({
  id: "care_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  memberName: "Ada Example",
  legalName: null,
  reason: "check_in",
  channel: "slack_dm",
  status: "waiting",
  endedHow: null,
  openedAt: "2026-03-01T15:00:00Z",
  periodEndsOn: "2026-03-31",
  ownerId: "11111111-1111-4111-8111-111111111111",
  ownerName: "Cam Example",
  period: 1,
  periodOver: false,
  renewed: false,
  lastActivityLabel: "today",
  lastSpeaker: null,
  closedLabel: null,
  followUpOn: null,
  followUpDue: false,
  nextStep: null,
  notes: null,
  ...over,
});

describe("careAttention", () => {
  it("counts review due and lapsed, and ignores everything else", () => {
    const attention = careAttention([card({ status: "review_due" }), card({ status: "lapsed" }), card({ status: "lapsed" }), card({ status: "waiting" }), card({ status: "closed" }), card({ status: "needs_reply" })]);
    expect([attention.reviewDue, attention.lapsed]).toEqual([1, 2]);
  });

  it("groups by owner, the most lapsed first, then the most review due, then by name, and shows nobody's as Unassigned", () => {
    const owner = (id: string, name: string) => ({ ownerId: id, ownerName: name });
    const attention = careAttention([
      card({ status: "review_due", ...owner("u-b", "Bea") }),
      card({ status: "review_due", ...owner("u-b", "Bea") }),
      card({ status: "lapsed", ...owner("u-c", "Cam") }),
      card({ status: "review_due", ...owner("u-a", "Abe") }),
      card({ status: "lapsed", ownerId: null, ownerName: "Unassigned" }),
      card({ status: "waiting", ...owner("u-d", "Dee") }),
    ]);
    expect(attention.byOwner).toEqual([
      { ownerId: "u-c", ownerName: "Cam", reviewDue: 0, lapsed: 1 },
      { ownerId: null, ownerName: "Unassigned", reviewDue: 0, lapsed: 1 },
      { ownerId: "u-b", ownerName: "Bea", reviewDue: 2, lapsed: 0 },
      { ownerId: "u-a", ownerName: "Abe", reviewDue: 1, lapsed: 0 },
    ]);
  });

  it("is empty when nothing is overdue", () => {
    expect(careAttention([card({}), card({ status: "closed" })])).toEqual({ reviewDue: 0, lapsed: 0, byOwner: [] });
    expect(careAttention([])).toEqual({ reviewDue: 0, lapsed: 0, byOwner: [] });
  });
});
