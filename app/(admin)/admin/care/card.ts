import { careStatus, daysAgoLabel, isFollowUpDue, lastActivityAt, memberWroteLast, periodNumber, type CareSettings, type CareStatus } from "@/lib/care";
import type { DmLink } from "@/lib/care-dm-link";
import { followsTrackedDm } from "@/lib/care-dm-rules";
import type { Participation } from "@/lib/care-participation";
import { ownerName, type CareOwner } from "@/lib/care-owners";
import type { CareScores } from "@/lib/care-scores";
import { formatDateOnly } from "@/lib/formatters";
import type { CareEngagementWithMember } from "@/lib/data/care";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { orgYmd } from "@/lib/org-week";

/** The latest thing a member did themselves in the community, worded for the row ("3/12/2026", "a prickle", "8 days ago"). */
export type ParticipationCard = { dateLabel: string; what: string; agoLabel: string };

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
  /** The Eastern calendar day it started (a plain date), and today's, for the date picker's limit. */
  startedOn: string;
  today: string;
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
  /** Who spoke last is kept up to date from the owner's tracked Slack DM with them, so logging a reply by hand isn't needed (the "They replied" / "I replied" buttons are hidden). */
  fromSlack: boolean;
  closedLabel: string | null;
  followUpOn: string | null;
  followUpDue: boolean;
  nextStep: string | null;
  notes: string | null;
  /** The member's engagement score (and tier) when the care period started and now; null when it could not be worked out. */
  scores: CareScores | null;
  /** Their latest own activity anywhere in the community; null when none is recorded, "unavailable" when it could not be read. Not the DM: that is `lastSpeaker`. */
  lastParticipation: ParticipationCard | "unavailable" | null;
  /** "Open the DM", for a Slack DM care period whose DM the signed-in staff user tracks and owns; null otherwise. */
  dmLink: DmLink | null;
};

export type CardOptions = {
  settings?: CareSettings;
  /** Everyone who may own one, for the owner's name. */
  owners?: readonly CareOwner[];
  /** The rows the page loaded, by id, to count which period of a chain this is. */
  byId?: ReadonlyMap<string, { renewed_from: string | null }>;
  /**
   * The signed-in staff user and the members whose Slack DM they track. An open Slack DM engagement they own with one of
   * those members is marked `fromSlack`. (Nobody can read another staff member's tracked list, so an engagement someone
   * else owns carries no hint.)
   */
  slackTracked?: { userId: string; memberIds: ReadonlySet<string>; /** "Open the DM" by member id. */ links?: ReadonlyMap<string, DmLink> };
  /** Engagement scores by care period id (`loadCareScores`). */
  scores?: ReadonlyMap<string, CareScores>;
  /** Each member's latest participation (`ActivityRepository.lastParticipation`). */
  participation?: ReadonlyMap<string, Participation>;
};

export function toEngagementCard(row: CareEngagementWithMember, now: Date, options: CardOptions = {}): EngagementCardData {
  const { settings, owners = [], byId = new Map(), slackTracked, scores, participation } = options;
  const ownsTrackedDm = !!slackTracked && followsTrackedDm(row, slackTracked);
  const last = participation?.get(row.member_id);
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
    startedOn: orgYmd(new Date(row.opened_at)),
    today: orgYmd(now),
    periodEndsOn: row.period_ends_on,
    ownerId: row.owned_by,
    ownerName: ownerName(row.owned_by, owners),
    period: periodNumber(row, byId),
    periodOver: orgYmd(now) > row.period_ends_on,
    renewed: row.renewed_from !== null,
    lastActivityLabel: daysAgoLabel(lastActivityAt(row), now),
    lastSpeaker: memberWroteLast(row) ? "member" : row.last_staff_message_at ? "staff" : null,
    fromSlack: ownsTrackedDm && row.closed_at === null,
    closedLabel: row.closed_at ? daysAgoLabel(row.closed_at, now) : null,
    followUpOn: row.follow_up_on,
    followUpDue: row.closed_at === null && isFollowUpDue(row.follow_up_on, now),
    nextStep: row.next_step,
    notes: row.notes,
    scores: scores?.get(row.id) ?? null,
    lastParticipation: !participation ? "unavailable" : last ? { dateLabel: formatDateOnly(orgYmd(new Date(last.occurredAt))), what: last.label, agoLabel: daysAgoLabel(last.occurredAt, now) } : null,
    dmLink: ownsTrackedDm ? (slackTracked?.links?.get(row.member_id) ?? null) : null,
  };
}
