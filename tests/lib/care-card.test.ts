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
  channel: "other", // the deprecated column, still on the row
  opened_at: ago(4),
  period_ends_on: "2026-04-15",
  owned_by: "11111111-1111-4111-8111-111111111111",
  renewed_from: null,
  closed_at: null,
  ended_how: null,
  last_staff_message_at: null,
  last_member_message_at: null,
  follow_up_on: null,
  handover_to: null,
  handover_by: null,
  handover_at: null,
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

  describe("fromSlack: kept up to date from the owner's tracked Slack DM", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const tracked = { userId: owner, memberIds: new Set(["mbr_AAAAAAAAAAA1"]) };

    it("is set for an open care plan she owns with a member whose DM she tracks, and for no one else's", () => {
      expect(toEngagementCard(row(), NOW, { slackTracked: tracked }).fromSlack).toBe(true);
      expect(toEngagementCard(row(), NOW).fromSlack).toBe(false);
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...tracked, userId: "22222222-2222-4222-8222-222222222222" } }).fromSlack).toBe(false);
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...tracked, memberIds: new Set() } }).fromSlack).toBe(false);
    });

    it("is not set for a closed care plan, is set whatever the deprecated channel column says, and is not set for a plan with no owner (whoever opened it does not own it)", () => {
      expect(toEngagementCard(row({ channel: "email" }), NOW, { slackTracked: tracked }).fromSlack).toBe(true);
      expect(toEngagementCard(row({ closed_at: ago(1), ended_how: "no_reply" }), NOW, { slackTracked: tracked }).fromSlack).toBe(false);
      expect(toEngagementCard(row({ owned_by: null, opened_by: owner }), NOW, { slackTracked: tracked }).fromSlack).toBe(false);
    });
  });
  it("carries the Eastern day it started and today's, not the UTC date", () => {
    // 23:30 Eastern on Mar 17 is already Mar 18 in UTC; "now" is 21:00 Eastern on Mar 19 (Mar 20 in UTC).
    const late = new Date("2026-03-20T01:00:00.000Z");
    expect(toEngagementCard(row({ opened_at: "2026-03-18T03:30:00.000Z" }), late)).toMatchObject({ startedOn: "2026-03-17", today: "2026-03-19" });
  });

  it("carries the scores for its care plan, or none", () => {
    const scores = new Map([["care_AAAAAAAAAAA1", { then: { score: 4, tier: "at_risk" as const }, now: { score: 60, tier: "highly_engaged" as const } }]]);
    expect(toEngagementCard(row(), NOW, { scores }).scores).toEqual(scores.get("care_AAAAAAAAAAA1"));
    expect(toEngagementCard(row({ id: "care_AAAAAAAAAAA2" }), NOW, { scores }).scores).toBeNull();
    expect(toEngagementCard(row(), NOW).scores).toBeNull();
  });

  it("words the member's last participation by Eastern day, what it was and how long ago, null when there is none, and says so when it could not be read", () => {
    const participation = new Map([["mbr_AAAAAAAAAAA1", { occurredAt: "2026-03-19T02:00:00.000Z", type: "prickle_attended", label: "a prickle" }]]); // 22:00 Eastern on Mar 18
    expect(toEngagementCard(row(), NOW, { participation }).lastParticipation).toEqual({ dateLabel: "3/18/2026", what: "a prickle", agoLabel: "yesterday" });
    expect(toEngagementCard(row({ member_id: "mbr_AAAAAAAAAAA2" }), NOW, { participation }).lastParticipation).toBeNull();
    expect(toEngagementCard(row(), NOW).lastParticipation).toBe("unavailable"); // the read failed or was not made
  });

  describe("dmLink", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const link = { href: "/chat/chn_AAAAAAAAAAA1", kind: "hub_chat" as const };
    const tracked = { userId: owner, memberIds: new Set(["mbr_AAAAAAAAAAA1"]), links: new Map([["mbr_AAAAAAAAAAA1", link]]) };

    it("is given for a care plan she owns with a member whose DM she tracks, open or closed", () => {
      expect(toEngagementCard(row(), NOW, { slackTracked: tracked }).dmLink).toEqual(link);
      expect(toEngagementCard(row({ closed_at: ago(1), ended_how: "no_reply" }), NOW, { slackTracked: tracked }).dmLink).toEqual(link);
    });

    it("is not given for someone else's, a DM she does not track, or when there is no link", () => {
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...tracked, userId: "22222222-2222-4222-8222-222222222222" } }).dmLink).toBeNull();
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...tracked, memberIds: new Set() } }).dmLink).toBeNull();
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...tracked, links: new Map() } }).dmLink).toBeNull();
      expect(toEngagementCard(row(), NOW).dmLink).toBeNull();
    });
  });

  describe("dmNote: why her own DM is not filling in a plan of hers", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const untracked = { userId: owner, memberIds: new Set<string>() };

    it("says to connect Slack when it is not connected, and that there is no DM yet when it is", () => {
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...untracked, access: "needs_slack" } }).dmNote).toBe("connect");
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...untracked, access: "ready" } }).dmNote).toBe("no_dm");
    });

    it("says nothing when the DM is tracked, the plan is closed or someone else's, or there is no Slack account to connect", () => {
      expect(toEngagementCard(row(), NOW, { slackTracked: { userId: owner, memberIds: new Set(["mbr_AAAAAAAAAAA1"]), access: "needs_slack" } }).dmNote).toBeNull();
      expect(toEngagementCard(row({ closed_at: ago(1), ended_how: "no_reply" }), NOW, { slackTracked: { ...untracked, access: "needs_slack" } }).dmNote).toBeNull();
      expect(toEngagementCard(row({ owned_by: "22222222-2222-4222-8222-222222222222" }), NOW, { slackTracked: { ...untracked, access: "needs_slack" } }).dmNote).toBeNull();
      expect(toEngagementCard(row({ owned_by: null }), NOW, { slackTracked: { ...untracked, access: "needs_slack" } }).dmNote).toBeNull();
      expect(toEngagementCard(row(), NOW, { slackTracked: { ...untracked, access: "no_member" } }).dmNote).toBeNull();
      expect(toEngagementCard(row(), NOW, { slackTracked: untracked }).dmNote).toBeNull(); // the connection could not be read
      expect(toEngagementCard(row(), NOW).dmNote).toBeNull();
    });
  });

  describe("hand-over", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const owners = [
      { id: owner, name: "Cam Example", role: "community_manager" },
      { id: other, name: "Dee Example", role: "admin" },
    ];
    const offered = row({ handover_to: other, handover_by: owner, handover_at: ago(1) });

    it("carries the pending offer by name, for the plan card to say who it is waiting for", () => {
      expect(toEngagementCard(offered, NOW, { owners }).handover).toEqual({ toName: "Dee Example", byName: "Cam Example", at: ago(1) });
      expect(toEngagementCard(row(), NOW, { owners }).handover).toBeNull();
    });

    it("tells the viewer what they may do: offer it (owner or admin), take it back, answer it (the receiver), claim it (nobody owns it)", () => {
      expect(toEngagementCard(row(), NOW, { owners, viewer: { userId: owner, isAdmin: false } }).controls).toMatchObject({ canPropose: true, pending: false });
      expect(toEngagementCard(offered, NOW, { owners, viewer: { userId: owner, isAdmin: false } }).controls).toMatchObject({ pending: true, canCancel: true, canPropose: false, offeredToMe: false });
      expect(toEngagementCard(offered, NOW, { owners, viewer: { userId: other, isAdmin: true } }).controls).toMatchObject({ offeredToMe: true, canCancel: true });
      expect(toEngagementCard(row({ owned_by: null }), NOW, { owners, viewer: { userId: other, isAdmin: false } }).controls).toMatchObject({ canClaim: true, canPropose: false });
    });
  });
});
