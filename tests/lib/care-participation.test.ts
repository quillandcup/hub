import { describe, expect, it } from "vitest";
import { isParticipation, latestParticipation, PARTICIPATION, PARTICIPATION_TYPES, type ParticipationRow } from "@/lib/care-participation";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const row = (member: string, type: string, at: string, actor = "member"): ParticipationRow => ({ member_id: member, activity_type: type, actor_kind: actor, occurred_at: at });

describe("what counts as taking part", () => {
  it("counts what the member did themselves in the community, of every kind in the list", () => {
    for (const type of PARTICIPATION_TYPES) expect(isParticipation({ activity_type: type, actor_kind: "member" })).toBe(true);
    expect(PARTICIPATION_TYPES).toEqual(expect.arrayContaining(["prickle_attended", "slack_message", "slack_thread_reply", "slack_reaction", "lesson_watched", "lesson_completed", "prickle_checkin", "prickle_checkout"]));
  });

  it("does not count logins, feedback or taking a check-in back, which are not taking part", () => {
    for (const type of ["hedgie_hub_login", "feedback_submitted", "prickle_checkin_cleared", "prickle_checkout_cleared"]) {
      expect(isParticipation({ activity_type: type, actor_kind: "member" })).toBe(false);
    }
  });

  it("does not count anything staff or the system wrote, even of a kind that counts", () => {
    for (const actor of ["staff", "system"]) expect(isParticipation({ activity_type: "prickle_attended", actor_kind: actor })).toBe(false);
    for (const type of ["care_started", "care_closed", "outreach_touch_logged", "sudo_started", "email_sent", "email_bounced"]) {
      expect(isParticipation({ activity_type: type, actor_kind: "member" })).toBe(false);
    }
    expect(isParticipation({ activity_type: "constructor", actor_kind: "member" })).toBe(false);
  });

  it("gives each counted type words that read after a date", () => {
    for (const label of Object.values(PARTICIPATION)) expect(label).toMatch(/^an? /);
  });
});

describe("latestParticipation", () => {
  it("picks each member's latest, by time and not by order, with what it was", () => {
    const found = latestParticipation([
      row(ADA, "prickle_attended", "2026-03-10T10:00:00.000Z"),
      row(ADA, "slack_message", "2026-03-12T10:00:00.000Z"),
      row(ADA, "lesson_completed", "2026-03-11T10:00:00.000Z"),
      row(BO, "prickle_attended", "2026-03-01T10:00:00.000Z"),
    ]);
    expect(found.get(ADA)).toEqual({ occurredAt: "2026-03-12T10:00:00.000Z", type: "slack_message", label: "a Slack message" });
    expect(found.get(BO)).toEqual({ occurredAt: "2026-03-01T10:00:00.000Z", type: "prickle_attended", label: "a prickle" });
  });

  it("skips logins, staff rows and system rows even when they are the latest, and leaves out a member with nothing that counts", () => {
    const found = latestParticipation([
      row(ADA, "prickle_attended", "2026-03-01T10:00:00.000Z"),
      row(ADA, "hedgie_hub_login", "2026-03-20T10:00:00.000Z"),
      row(ADA, "care_started", "2026-03-21T10:00:00.000Z", "staff"),
      row(ADA, "prickle_commitment_created", "2026-03-22T10:00:00.000Z", "staff"),
      row(ADA, "email_sent", "2026-03-23T10:00:00.000Z", "system"),
      row(BO, "hedgie_hub_login", "2026-03-20T10:00:00.000Z"),
    ]);
    expect(found.get(ADA)).toMatchObject({ type: "prickle_attended", occurredAt: "2026-03-01T10:00:00.000Z" });
    expect(found.has(BO)).toBe(false);
  });

  it("compares instants, not strings, and breaks a tie the same way whatever the order", () => {
    const a = row(ADA, "slack_message", "2026-03-10T10:00:00.000Z");
    const b = row(ADA, "prickle_attended", "2026-03-10T06:00:00-04:00"); // the same instant, written differently
    expect(latestParticipation([a, b]).get(ADA)?.type).toBe("prickle_attended");
    expect(latestParticipation([b, a]).get(ADA)?.type).toBe("prickle_attended");
    const later = row(ADA, "slack_reaction", "2026-03-10T09:00:00-04:00"); // 13:00Z, later than 10:00Z
    expect(latestParticipation([a, later]).get(ADA)?.type).toBe("slack_reaction");
  });

  it("is empty for no rows", () => {
    expect(latestParticipation([]).size).toBe(0);
  });
});
