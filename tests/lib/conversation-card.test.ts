import { describe, expect, it } from "vitest";
import { toConversationCard } from "@/app/(admin)/admin/conversations/card";
import type { ConversationWithMember } from "@/lib/data/conversations";

const NOW = new Date("2026-03-20T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000 - 60_000).toISOString();

const row = (over: Partial<ConversationWithMember> = {}): ConversationWithMember => ({
  id: "conv_AAAAAAAAAAA1",
  member_id: "mbr_AAAAAAAAAAA1",
  opened_by: null,
  reason: "hello",
  channel: "slack_dm",
  opened_at: ago(4),
  closed_at: null,
  outcome: null,
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

describe("toConversationCard", () => {
  it("shows the display name and keeps the legal name beside it only when it differs", () => {
    expect(toConversationCard(row(), NOW)).toMatchObject({ memberName: "Ada E.", legalName: "Ada Example" });
    expect(toConversationCard(row({ member: { id: "mbr_AAAAAAAAAAA1", name: "Bo Example", display_name: null } }), NOW)).toMatchObject({ memberName: "Bo Example", legalName: null });
  });

  it("copes with a member who is gone", () => {
    expect(toConversationCard(row({ member: null }), NOW)).toMatchObject({ memberName: "A member who is no longer here", legalName: null });
  });

  it("names who spoke last: the member when they wrote after her, her otherwise, nobody when nothing is logged", () => {
    expect(toConversationCard(row({ last_staff_message_at: ago(3), last_member_message_at: ago(1) }), NOW)).toMatchObject({ lastSpeaker: "member", status: "needs_reply", lastActivityLabel: "yesterday" });
    expect(toConversationCard(row({ last_staff_message_at: ago(1), last_member_message_at: ago(3) }), NOW)).toMatchObject({ lastSpeaker: "staff", status: "waiting" });
    expect(toConversationCard(row({ last_member_message_at: ago(1) }), NOW).lastSpeaker).toBe("member");
    expect(toConversationCard(row(), NOW)).toMatchObject({ lastSpeaker: null, lastActivityLabel: "4 days ago" });
  });

  it("flags a follow-up that is due, but not on a closed conversation", () => {
    expect(toConversationCard(row({ follow_up_on: "2026-03-20" }), NOW).followUpDue).toBe(true);
    expect(toConversationCard(row({ follow_up_on: "2026-03-21" }), NOW).followUpDue).toBe(false);
    expect(toConversationCard(row({ follow_up_on: "2026-03-01", closed_at: ago(1), outcome: "resolved" }), NOW)).toMatchObject({ followUpDue: false, status: "closed", closedLabel: "yesterday", outcome: "resolved" });
  });

  it("takes the quiet window from the caller when given one", () => {
    expect(toConversationCard(row({ last_staff_message_at: ago(4) }), NOW, 3).status).toBe("gone_quiet");
  });
});
