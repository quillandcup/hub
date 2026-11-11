import { describe, expect, it } from "vitest";
import { toEngagementCard } from "@/app/(admin)/admin/care/card";
import type { CareEngagementWithMember } from "@/lib/data/care";

const NOW = new Date("2026-03-20T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000 - 60_000).toISOString();
const settings = { engagementDays: 30, lapseGraceDays: 14, quietDays: 14 };

const row = (over: Partial<CareEngagementWithMember> = {}): CareEngagementWithMember => ({
  id: "care_AAAAAAAAAAA1",
  member_id: "mbr_AAAAAAAAAAA1",
  opened_by: null,
  reason: "introduction",
  channel: "slack_dm",
  opened_at: ago(4),
  period_ends_on: "2026-04-15",
  owned_by: "11111111-1111-4111-8111-111111111111",
  renewed_from: null,
  closed_at: null,
  ended_how: null,
  last_staff_message_at: null,
  last_member_message_at: null,
  follow_up_on: null,
  next_step: null,
  notes: null,
  deleted_at: null,
  created_at: ago(4),
  updated_at: ago(4),
  member: { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", display_name: "Ada E." },
  ...over,
});

describe("toEngagementCard", () => {
  it("shows the display name and keeps the legal name beside it only when it differs", () => {
    expect(toEngagementCard(row(), NOW)).toMatchObject({ memberName: "Ada E.", legalName: "Ada Example" });
    expect(toEngagementCard(row({ member: { id: "mbr_AAAAAAAAAAA1", name: "Bo Example", display_name: null } }), NOW)).toMatchObject({ memberName: "Bo Example", legalName: null });
  });

  it("copes with a member who is gone", () => {
    expect(toEngagementCard(row({ member: null }), NOW)).toMatchObject({ memberName: "A member who is no longer here", legalName: null });
  });

  it("names who spoke last: the member when they wrote after her, her otherwise, nobody when nothing is logged", () => {
    expect(toEngagementCard(row({ last_staff_message_at: ago(3), last_member_message_at: ago(1) }), NOW)).toMatchObject({ lastSpeaker: "member", status: "needs_reply", lastActivityLabel: "yesterday" });
    expect(toEngagementCard(row({ last_staff_message_at: ago(1), last_member_message_at: ago(3) }), NOW)).toMatchObject({ lastSpeaker: "staff", status: "waiting" });
    expect(toEngagementCard(row({ last_member_message_at: ago(1) }), NOW).lastSpeaker).toBe("member");
    expect(toEngagementCard(row(), NOW)).toMatchObject({ lastSpeaker: null, lastActivityLabel: "4 days ago" });
  });

  it("carries the period, and whether it continues an earlier one", () => {
    expect(toEngagementCard(row(), NOW)).toMatchObject({ periodEndsOn: "2026-04-15", periodOver: false, renewed: false });
    expect(toEngagementCard(row({ period_ends_on: "2026-03-20" }), NOW).periodOver).toBe(false); // its last day is today
    expect(toEngagementCard(row({ period_ends_on: "2026-03-19" }), NOW).periodOver).toBe(true);
    expect(toEngagementCard(row({ renewed_from: "care_AAAAAAAAAAA0" }), NOW).renewed).toBe(true);
  });

  it("derives review due and lapsed from the period, and keeps needs_reply when the member wrote last", () => {
    expect(toEngagementCard(row({ period_ends_on: "2026-03-19" }), NOW, { settings }).status).toBe("review_due");
    expect(toEngagementCard(row({ period_ends_on: "2026-03-01" }), NOW, { settings }).status).toBe("lapsed");
    expect(toEngagementCard(row({ period_ends_on: "2026-03-01", last_member_message_at: ago(1) }), NOW, { settings }).status).toBe("needs_reply");
  });

  it("flags a follow-up that is due, but not on a closed engagement", () => {
    expect(toEngagementCard(row({ follow_up_on: "2026-03-20" }), NOW).followUpDue).toBe(true);
    expect(toEngagementCard(row({ follow_up_on: "2026-03-21" }), NOW).followUpDue).toBe(false);
    expect(toEngagementCard(row({ follow_up_on: "2026-03-01", closed_at: ago(1), ended_how: "no_reply" }), NOW)).toMatchObject({ followUpDue: false, status: "closed", closedLabel: "yesterday", endedHow: "no_reply" });
  });

  it("names the owner and counts which period of a chain it is", () => {
    const owners = [{ id: "11111111-1111-4111-8111-111111111111", name: "Cam Manager", role: "community_manager" }];
    const first = row({ id: "care_AAAAAAAAAAA1", renewed_from: null });
    const second = row({ id: "care_AAAAAAAAAAA2", renewed_from: "care_AAAAAAAAAAA1" });
    const third = row({ id: "care_AAAAAAAAAAA3", renewed_from: "care_AAAAAAAAAAA2", owned_by: null });
    const byId = new Map([first, second, third].map((r) => [r.id, r]));

    expect(toEngagementCard(first, NOW, { owners, byId })).toMatchObject({ ownerId: first.owned_by, ownerName: "Cam Manager", period: 1 });
    expect(toEngagementCard(second, NOW, { owners, byId }).period).toBe(2);
    expect(toEngagementCard(third, NOW, { owners, byId })).toMatchObject({ ownerId: null, ownerName: "Unassigned", period: 3 });
    expect(toEngagementCard(first, NOW)).toMatchObject({ ownerName: "A staff member", period: 1 });
  });

  it("takes the settings from the caller when given them", () => {
    expect(toEngagementCard(row({ last_staff_message_at: ago(4) }), NOW, { settings: { ...settings, quietDays: 3 } }).status).toBe("gone_quiet");
  });
});
