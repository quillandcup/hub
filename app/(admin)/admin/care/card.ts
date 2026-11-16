import { careStatus, daysAgoLabel, isFollowUpDue, lastActivityAt, memberWroteLast, periodNumber, type CareSettings, type CareStatus } from "@/lib/care";
import type { OwnDmAccess } from "@/lib/care-dm";
import type { DmLink } from "@/lib/care-dm-link";
import { careOwnerOf, followsTrackedDm } from "@/lib/care-dm-rules";
import { handoverControls, type HandoverControls, type HandoverViewer } from "@/lib/care-handover";
import type { Participation } from "@/lib/care-participation";
import { ownerName, type CareOwner } from "@/lib/care-owners";
import type { CareScores } from "@/lib/care-scores";
import { formatDateOnly } from "@/lib/formatters";
import type { CareEngagementWithMember } from "@/lib/data/care";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { orgYmd } from "@/lib/org-week";

/** The latest thing a member did themselves in the community, worded for the row ("3/12/2026", "a prickle", "8 days ago"). */
export type ParticipationCard = { dateLabel: string; what: string; agoLabel: string };

/** A hand-over waiting for the receiver's answer, worded for the row: names, never ids beyond the receiver's (the page compares it with the viewer). */
export type HandoverCard = { toName: string; /** Who proposed it: the owner, or an admin on their behalf. */ byName: string; at: string };

/** An admin took this plan over from its owner, worded for the previous owner's notice (`taken_from` is the viewer): names and a day, nothing else. */
export type TakeoverNotice = { byName: string; /** The day it happened, as the page words it ("11/15/2026"). */ onLabel: string };

/** What the plan card says when the owner's own Slack DM with the member is not there to fill it in: connect Slack, or there is no DM yet. */
export type DmNote = "connect" | "no_dm";

/** One engagement as the page's client components need it: names resolved, status and "how long ago" worked out on the server. */
export type EngagementCardData = {
  id: string;
  memberId: string;
  /** The name the community knows them by (.claude/rules/display-names.md, "Display Names"). */
  memberName: string;
  /** The legal name, only when it differs, small and muted beside the display name. */
  legalName: string | null;
  reason: string;
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
  /** The member's engagement score (and tier) when the care plan started and now; null when it could not be worked out. */
  scores: CareScores | null;
  /** Their latest own activity anywhere in the community; null when none is recorded, "unavailable" when it could not be read. Not the DM: that is `lastSpeaker`. */
  lastParticipation: ParticipationCard | "unavailable" | null;
  /** "Open the DM", for a care plan whose DM the signed-in staff user tracks and owns; null otherwise. */
  dmLink: DmLink | null;
  /** On an open care plan the signed-in user owns whose DM is not tracked: why (Slack is not connected, or there is no DM with them yet). Null otherwise: never shown for someone else's plan. */
  dmNote: DmNote | null;
  /** The pending hand-over, or null. The plan keeps its owner until the receiver accepts. */
  handover: HandoverCard | null;
  /** What the signed-in user may do with the hand-over (offer, take back, accept or decline, claim, take over). */
  controls: HandoverControls;
  /** An admin took this plan over from the signed-in user and they have not dismissed the notice yet; null otherwise (never shown for anyone else). */
  takeoverNotice: TakeoverNotice | null;
};

export type CardOptions = {
  settings?: CareSettings;
  /** Everyone who may own one, for the owner's name. */
  owners?: readonly CareOwner[];
  /** The rows the page loaded, by id, to count which period of a chain this is. */
  byId?: ReadonlyMap<string, { renewed_from: string | null }>;
  /**
   * The signed-in staff user and the members whose Slack DM they track. An open care plan they own with one of
   * those members is marked `fromSlack`. (Nobody can read another staff member's tracked list, so a care plan someone
   * else owns carries no hint.)
   */
  slackTracked?: {
    userId: string;
    memberIds: ReadonlySet<string>;
    /** "Open the DM" by member id. */
    links?: ReadonlyMap<string, DmLink>;
    /** Whether her own Slack DMs can fill in her plans at all (`ownDmAccess`); decides the note on a plan with no tracked DM. */
    access?: OwnDmAccess;
  };
  /** The signed-in staff user, for the hand-over controls. */
  viewer?: HandoverViewer;
  /** Engagement scores by care plan id (`loadCareScores`). */
  scores?: ReadonlyMap<string, CareScores>;
  /** Each member's latest participation (`ActivityRepository.lastParticipation`). */
  participation?: ReadonlyMap<string, Participation>;
};

export function toEngagementCard(row: CareEngagementWithMember, now: Date, options: CardOptions = {}): EngagementCardData {
  const { settings, owners = [], byId = new Map(), slackTracked, scores, participation, viewer = { userId: "", isAdmin: false } } = options;
  const ownsTrackedDm = !!slackTracked && followsTrackedDm(row, slackTracked);
  const last = participation?.get(row.member_id);
  const shown = row.member ? getMemberDisplayName(row.member) : "A member who is no longer here";
  // Her plan, still open, and nothing tracked to fill it in: say why, quietly (never for someone else's plan: her list is hers).
  const dmNote: DmNote | null =
    !!slackTracked && row.closed_at === null && !ownsTrackedDm && careOwnerOf(row) === slackTracked.userId
      ? slackTracked.access === "needs_slack"
        ? "connect"
        : slackTracked.access === "ready"
          ? "no_dm"
          : null
      : null;
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: shown,
    legalName: row.member && shown !== row.member.name ? row.member.name : null,
    reason: row.reason,
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
    dmNote,
    handover: row.handover_to ? { toName: ownerName(row.handover_to, owners), byName: ownerName(row.handover_by, owners), at: row.handover_at ?? row.updated_at } : null,
    controls: handoverControls(row, viewer),
    takeoverNotice:
      viewer.userId !== "" && row.taken_from === viewer.userId && row.taken_seen_at === null && row.taken_at !== null
        ? { byName: row.taken_by ? ownerName(row.taken_by, owners) : "An admin", onLabel: formatDateOnly(orgYmd(new Date(row.taken_at))) }
        : null,
  };
}
