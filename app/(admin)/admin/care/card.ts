import { careStatus, daysAgoLabel, isFollowUpDue, lastActivityAt, memberWroteLast, periodNumber, type CareSettings, type CareStatus } from "@/lib/care";
import { ownerName, type CareOwner } from "@/lib/care-owners";
import type { CareEngagementWithMember } from "@/lib/data/care";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { orgYmd } from "@/lib/org-week";

/** One engagement as the page's client components need it: names resolved, status and "how long ago" worked out on the server. */
export type EngagementCardData = {
  id: string;
  memberId: string;
  /** The name the community knows them by (CLAUDE.md, "Display Names"). */
  memberName: string;
  /** The legal name, only when it differs, small and muted beside the display name. */
  legalName: string | null;
  reason: string;
  channel: string;
  status: CareStatus;
  endedHow: string | null;
  openedAt: string;
  /** The last day of the period (a plain date). */
  periodEndsOn: string;
  /** The period's last day is behind us (an Eastern calendar day), whether or not it was closed. */
  periodOver: boolean;
  /** This period continues an earlier one. */
  renewed: boolean;
  /** The auth user id of its owner (null: unassigned) and the name shown for them. */
  ownerId: string | null;
  ownerName: string;
  /** Which period of a chain of renewals this is (the first is 1). */
  period: number;
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

export type CardOptions = {
  settings?: CareSettings;
  /** Everyone who may own one, for the owner's name. */
  owners?: readonly CareOwner[];
  /** The rows the page loaded, by id, to count which period of a chain this is. */
  byId?: ReadonlyMap<string, { renewed_from: string | null }>;
};

export function toEngagementCard(row: CareEngagementWithMember, now: Date, options: CardOptions = {}): EngagementCardData {
  const { settings, owners = [], byId = new Map() } = options;
  const shown = row.member ? getMemberDisplayName(row.member) : "A member who is no longer here";
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: shown,
    legalName: row.member && shown !== row.member.name ? row.member.name : null,
    reason: row.reason,
    channel: row.channel,
    status: careStatus(row, now, settings),
    endedHow: row.ended_how,
    openedAt: row.opened_at,
    periodEndsOn: row.period_ends_on,
    ownerId: row.owned_by,
    ownerName: ownerName(row.owned_by, owners),
    period: periodNumber(row, byId),
    periodOver: orgYmd(now) > row.period_ends_on,
    renewed: row.renewed_from !== null,
    lastActivityLabel: daysAgoLabel(lastActivityAt(row), now),
    lastSpeaker: memberWroteLast(row) ? "member" : row.last_staff_message_at ? "staff" : null,
    closedLabel: row.closed_at ? daysAgoLabel(row.closed_at, now) : null,
    followUpOn: row.follow_up_on,
    followUpDue: row.closed_at === null && isFollowUpDue(row.follow_up_on, now),
    nextStep: row.next_step,
    notes: row.notes,
  };
}
