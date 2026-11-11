import {
  conversationStatus,
  daysAgoLabel,
  isFollowUpDue,
  lastActivityAt,
  type ConversationStatus,
} from "@/lib/conversations";
import type { ConversationWithMember } from "@/lib/data/conversations";
import { getMemberDisplayName } from "@/lib/member-display-name";

/** One conversation as the page's client components need it: names resolved, status and "how long ago" worked out on the server. */
export type ConversationCardData = {
  id: string;
  memberId: string;
  /** The name the community knows them by (CLAUDE.md, "Display Names"). */
  memberName: string;
  /** The legal name, only when it differs, small and muted beside the display name. */
  legalName: string | null;
  reason: string;
  channel: string;
  status: ConversationStatus;
  outcome: string | null;
  openedAt: string;
  /** "3 days ago": the last message from either side, or when it was opened if none is logged. */
  lastActivityLabel: string;
  /** Who spoke last, for the line under the name; null when nobody has been logged. */
  lastSpeaker: "member" | "staff" | null;
  closedLabel: string | null;
  followUpOn: string | null;
  followUpDue: boolean;
  nextStep: string | null;
  notes: string | null;
};

export function toConversationCard(row: ConversationWithMember, now: Date, quietDays?: number): ConversationCardData {
  const shown = row.member ? getMemberDisplayName(row.member) : "A member who is no longer here";
  const speaker =
    row.last_member_message_at && (!row.last_staff_message_at || row.last_member_message_at > row.last_staff_message_at)
      ? "member"
      : row.last_staff_message_at
        ? "staff"
        : null;
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: shown,
    legalName: row.member && shown !== row.member.name ? row.member.name : null,
    reason: row.reason,
    channel: row.channel,
    status: conversationStatus(row, now, quietDays),
    outcome: row.outcome,
    openedAt: row.opened_at,
    lastActivityLabel: daysAgoLabel(lastActivityAt(row), now),
    lastSpeaker: speaker,
    closedLabel: row.closed_at ? daysAgoLabel(row.closed_at, now) : null,
    followUpOn: row.follow_up_on,
    followUpDue: row.closed_at === null && isFollowUpDue(row.follow_up_on, now),
    nextStep: row.next_step,
    notes: row.notes,
  };
}
