import { getMemberDisplayName } from "@/lib/member-display-name";
import { parseDateOnly } from "@/lib/member-tenure";
import type { AttendanceRepository } from "@/lib/data/attendance";
import type { MentorshipRepository } from "@/lib/data/mentorship";
import type { Repos } from "@/lib/data/repos";

export type { BadgeType, BadgeLevel } from "@/lib/data/badges";
import type { BadgeType, BadgeLevel } from "@/lib/data/badges";

export type BadgeRepos = Pick<Repos, "attendance" | "badges" | "books" | "members" | "mentorship" | "prickles" | "programs">;

export interface EarnedBadge {
  badgeType: BadgeType;
  /** Display label for the member's current level/occurrence -- badgeType.name for a
   * non-leveled badge, or the highest-reached badge_levels.name for a leveled one. */
  levelName: string;
  level: number | null;
  occurrences: number;
  firstAwardedAt: string | null;
  lastAwardedAt: string | null;
  note: string | null;
}

/**
 * Inputs to every is_automatic badge type's computation, gathered once per member so
 * computeEarnedBadges can stay a pure function. Adding a new automatic badge means adding a
 * field here, a case in computeEarnedBadges, and (if it needs a query) a getter below.
 */
export interface AutomaticBadgeMetrics {
  totalPricklesAttended: number;
  firstJoinedAt: string | null;
  hostedQuarterCount: number;
  publishedBookCount: number;
  /** Programs this member has completed, keyed by program_id -- see getProgramCompletions. */
  programCompletions: Map<string, ProgramCompletion>;
  /** The Big Sister program matches this member has mentored, if any (omitted by callers that
   * don't compute it). */
  mentorship?: MentorshipCount;
}

/** How many trial members a big sister has mentored (matches whose trial has started), and the
 * first and last trial start dates -- from the mentorship_counts() function, see getMentorshipCounts. */
export interface MentorshipCount {
  count: number;
  firstStartedOn: string;
  lastStartedOn: string;
}

/** One member's completion history for a single program: how many enrolled cohorts have ended,
 * and the earliest/latest of those end dates. */
export interface ProgramCompletion {
  occurrences: number;
  firstCompletedAt: string;
  lastCompletedAt: string;
}

/** Where a badge's chip links: a retreat badge to its event, the Big Sister badge to the program
 * page (only for a viewer who has the big_sisters preview, since the page is behind it), others
 * nowhere. */
export function badgeHref(
  badgeType: Pick<BadgeType, "key" | "event_slug">,
  options: { bigSistersEnabled?: boolean } = {}
): string | null {
  if (badgeType.event_slug) return `/events/${badgeType.event_slug}`;
  if (badgeType.key === "hedgie_mentor" && options.bigSistersEnabled) return "/big-sisters";
  return null;
}

/** The highest level whose threshold is met by `occurrences`, or null if none is met yet
 * (e.g. a leveled badge type with no threshold=1 level, and zero occurrences so far). */
export function deriveLevel(levels: BadgeLevel[], occurrences: number): BadgeLevel | null {
  let best: BadgeLevel | null = null;
  for (const level of levels) {
    if (level.threshold != null && level.threshold > occurrences) continue;
    if (!best || level.level > best.level) best = level;
  }
  return best;
}

// "Founding Hedgie" covers members who joined during 2021 or through the end of January 2022 --
// the org's founding era, per the badge spec ("those who joined in 2021 and maybe early 2022").
export function isFoundingHedgie(firstJoinedAt: string | null): boolean {
  if (!firstJoinedAt) return false;
  const d = parseDateOnly(firstJoinedAt);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  return year === 2021 || (year === 2022 && month === 0);
}

// "YYYY-Qn" for a timestamptz, in UTC -- used to count distinct quarters hosted for the
// automatic Hostess badge. UTC (rather than org-local time) keeps this deterministic regardless
// of where it runs; a prickle within a few hours of a quarter boundary landing in the "wrong"
// quarter doesn't change which levels a host has reached.
export function quarterKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${quarter}`;
}

function pushAutomaticLeveled(
  earned: EarnedBadge[],
  badgeType: BadgeType,
  levels: BadgeLevel[],
  occurrences: number
) {
  const level = deriveLevel(levels, occurrences);
  if (!level) return;
  earned.push({
    badgeType,
    levelName: level.name,
    level: level.level,
    occurrences,
    firstAwardedAt: null,
    lastAwardedAt: null,
    note: null,
  });
}

/** Adds one occurrence to a running ProgramCompletion map (either "programId -> completion" for
 * one member, or "memberId -> completion" for one program in bulk) -- generic over what the key
 * represents. */
function mergeCompletion(completions: Map<string, ProgramCompletion>, key: string, expiresAt: string) {
  const existing = completions.get(key);
  if (existing) {
    existing.occurrences += 1;
    if (expiresAt < existing.firstCompletedAt) existing.firstCompletedAt = expiresAt;
    if (expiresAt > existing.lastCompletedAt) existing.lastCompletedAt = expiresAt;
  } else {
    completions.set(key, { occurrences: 1, firstCompletedAt: expiresAt, lastCompletedAt: expiresAt });
  }
}

/** Merges a program's computed cohort-completion count with any legacy manually-awarded
 * member_badges rows for the same badge type (pre-dating program/cohort tracking), so switching
 * program_180/self_editing_academy to computed badges doesn't drop history for members awarded
 * before enrollment tracking existed. */
function pushProgramCompletion(
  earned: EarnedBadge[],
  badgeType: BadgeType,
  levels: BadgeLevel[],
  completion: ProgramCompletion | undefined,
  legacyAwards: { occurred_at: string; note: string | null }[]
) {
  const dates = [
    ...(completion ? [completion.firstCompletedAt, completion.lastCompletedAt] : []),
    ...legacyAwards.map((a) => a.occurred_at),
  ];
  if (dates.length === 0) return;
  dates.sort();

  const occurrences = (completion?.occurrences ?? 0) + legacyAwards.length;
  const level = badgeType.has_levels ? deriveLevel(levels, occurrences) : null;
  earned.push({
    badgeType,
    levelName: level?.name ?? badgeType.name,
    level: level?.level ?? null,
    occurrences,
    firstAwardedAt: dates[0],
    lastAwardedAt: dates[dates.length - 1],
    note: legacyAwards[legacyAwards.length - 1]?.note ?? null,
  });
}

/** The automatic Big Sister badge: matches counted from the mentorships table, merged with any
 * member_badges rows awarded by hand before the program was tracked here. Both describe the same
 * mentoring, so the larger number wins rather than adding them up -- a hand-awarded badge never
 * drops a level, and a tracked match is never counted twice. */
function pushMentorship(
  earned: EarnedBadge[],
  badgeType: BadgeType,
  levels: BadgeLevel[],
  mentorship: MentorshipCount | undefined,
  legacyAwards: { occurred_at: string; note: string | null }[]
) {
  const occurrences = Math.max(mentorship?.count ?? 0, legacyAwards.length);
  const dates = [
    ...(mentorship ? [mentorship.firstStartedOn, mentorship.lastStartedOn] : []),
    ...legacyAwards.map((a) => a.occurred_at),
  ].sort();
  const level = deriveLevel(levels, occurrences);
  if (!level) return;
  earned.push({
    badgeType,
    levelName: level.name,
    level: level.level,
    occurrences,
    firstAwardedAt: dates[0],
    lastAwardedAt: dates[dates.length - 1],
    note: legacyAwards[legacyAwards.length - 1]?.note ?? null,
  });
}

/**
 * Merges manually-awarded badges (member_badges rows) with the automatically-computed ones
 * (prickle milestones, Founding Hedgie, Hostess, Published Author) into one earned-badges list,
 * ready to render.
 */
export function computeEarnedBadges(
  badgeTypes: BadgeType[],
  levelsByBadgeType: Map<string, BadgeLevel[]>,
  awards: { badge_type_id: string; occurred_at: string; note: string | null }[],
  metrics: AutomaticBadgeMetrics
): EarnedBadge[] {
  const earned: EarnedBadge[] = [];

  const awardsByType = new Map<string, { occurred_at: string; note: string | null }[]>();
  for (const award of awards) {
    const list = awardsByType.get(award.badge_type_id) ?? [];
    list.push(award);
    awardsByType.set(award.badge_type_id, list);
  }

  for (const badgeType of badgeTypes) {
    const levels = levelsByBadgeType.get(badgeType.id) ?? [];
    const typeAwards = awardsByType.get(badgeType.id) ?? [];

    if (badgeType.is_automatic) {
      switch (badgeType.key) {
        case "prickle_milestones":
          pushAutomaticLeveled(earned, badgeType, levels, metrics.totalPricklesAttended);
          break;
        case "hostess":
          pushAutomaticLeveled(earned, badgeType, levels, metrics.hostedQuarterCount);
          break;
        case "published_author":
          pushAutomaticLeveled(earned, badgeType, levels, metrics.publishedBookCount);
          break;
        case "hedgie_mentor":
          pushMentorship(earned, badgeType, levels, metrics.mentorship, typeAwards);
          break;
        case "founding_hedgie":
          if (isFoundingHedgie(metrics.firstJoinedAt)) {
            earned.push({
              badgeType,
              levelName: badgeType.name,
              level: null,
              occurrences: 1,
              firstAwardedAt: metrics.firstJoinedAt,
              lastAwardedAt: metrics.firstJoinedAt,
              note: null,
            });
          }
          break;
        default:
          if (badgeType.program_id) {
            pushProgramCompletion(
              earned,
              badgeType,
              levels,
              metrics.programCompletions.get(badgeType.program_id),
              typeAwards
            );
          }
      }
      continue;
    }

    if (typeAwards.length === 0) continue;

    const occurrences = typeAwards.length;
    const sorted = [...typeAwards].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    if (badgeType.has_levels) {
      const level = deriveLevel(levels, occurrences);
      earned.push({
        badgeType,
        levelName: level?.name ?? badgeType.name,
        level: level?.level ?? null,
        occurrences,
        firstAwardedAt: sorted[0].occurred_at,
        lastAwardedAt: sorted[sorted.length - 1].occurred_at,
        note: sorted[sorted.length - 1].note,
      });
    } else {
      earned.push({
        badgeType,
        levelName: badgeType.name,
        level: null,
        occurrences,
        firstAwardedAt: sorted[0].occurred_at,
        lastAwardedAt: sorted[sorted.length - 1].occurred_at,
        note: sorted[sorted.length - 1].note,
      });
    }
  }

  return earned;
}

/** Distinct calendar quarters (UTC) in which `memberId` hosted at least one prickle, from
 * prickles.host -- real hosting history, not member_badges. Paginated per CLAUDE.md, though a
 * single host's row count is well under the 1000-row default limit in practice. */
export async function getHostedQuarterCount(
  repos: BadgeRepos,
  memberId: string
): Promise<number> {
  const hosted = await repos.prickles.hostedStartTimes({ hostId: memberId });
  const quarters = new Set(hosted.map((h) => quarterKey(h.startTime)));
  return quarters.size;
}

/** Number of books `memberId` has logged on the Hedgie Bookshelf (member_books). */
export async function getPublishedBookCount(
  repos: BadgeRepos,
  memberId: string
): Promise<number> {
  return repos.books.countLive(memberId);
}

export interface BadgeRecipient {
  memberId: string;
  /** Display name; `memberRealName` is the legal name when it differs. */
  memberName: string;
  memberRealName?: string;
  memberEmail: string;
  levelName: string;
  level: number | null;
  occurrences: number;
  firstAwardedAt: string | null;
  lastAwardedAt: string | null;
  note: string | null;
}

export interface RecipientMember {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
  firstJoinedAt: string | null;
}

/** Bulk equivalent of AutomaticBadgeMetrics: per-member counts for every automatic badge,
 * gathered once (across all members) so computeBadgeRecipients can stay a pure function. */
export interface BulkAutomaticMetrics {
  attendedPrickleCountsByMember: Map<string, number>;
  hostedQuarterCountsByMember: Map<string, number>;
  publishedBookCountsByMember: Map<string, number>;
  /** Program completions, keyed by program_id then member_id -- bulk counterpart to
   * AutomaticBadgeMetrics.programCompletions, see getProgramCompletionsByProgram. */
  programCompletionsByProgramId: Map<string, Map<string, ProgramCompletion>>;
  /** Big Sister matches per mentor -- bulk counterpart to AutomaticBadgeMetrics.mentorship. */
  mentorshipByMember?: Map<string, MentorshipCount>;
}

function recipientNames(member: RecipientMember): { memberName: string; memberRealName?: string } {
  const memberName = getMemberDisplayName({ name: member.name, display_name: member.displayName });
  return memberName === member.name ? { memberName } : { memberName, memberRealName: member.name };
}

function pushLeveledRecipient(
  recipients: BadgeRecipient[],
  member: RecipientMember,
  levels: BadgeLevel[],
  occurrences: number
) {
  const level = deriveLevel(levels, occurrences);
  if (!level) return;
  recipients.push({
    memberId: member.id,
    ...recipientNames(member),
    memberEmail: member.email,
    levelName: level.name,
    level: level.level,
    occurrences,
    firstAwardedAt: null,
    lastAwardedAt: null,
    note: null,
  });
}

/**
 * Every member who has earned `badgeType`, given all members and the same shape of inputs as
 * computeEarnedBadges but gathered in bulk across every member instead of one -- the reverse
 * direction of computeEarnedBadges (badge type -> members, instead of member -> badge types).
 * Pure function: see getBadgeRecipients for the Supabase-backed bulk queries that feed it.
 */
export function computeBadgeRecipients(
  badgeType: BadgeType,
  levels: BadgeLevel[],
  members: RecipientMember[],
  awards: { member_id: string; occurred_at: string; note: string | null }[],
  metrics: BulkAutomaticMetrics
): BadgeRecipient[] {
  const membersById = new Map(members.map((m) => [m.id, m]));
  const recipients: BadgeRecipient[] = [];

  if (badgeType.is_automatic) {
    switch (badgeType.key) {
      case "prickle_milestones":
        for (const [memberId, occurrences] of metrics.attendedPrickleCountsByMember) {
          const member = membersById.get(memberId);
          if (member) pushLeveledRecipient(recipients, member, levels, occurrences);
        }
        break;
      case "hostess":
        for (const [memberId, occurrences] of metrics.hostedQuarterCountsByMember) {
          const member = membersById.get(memberId);
          if (member) pushLeveledRecipient(recipients, member, levels, occurrences);
        }
        break;
      case "published_author":
        for (const [memberId, occurrences] of metrics.publishedBookCountsByMember) {
          const member = membersById.get(memberId);
          if (member) pushLeveledRecipient(recipients, member, levels, occurrences);
        }
        break;
      case "hedgie_mentor": {
        // `awards` is the hand-awarded rows for this badge type (see pushMentorship's merge rule).
        const legacyByMember = new Map<string, { occurred_at: string; note: string | null }[]>();
        for (const award of awards) {
          const list = legacyByMember.get(award.member_id) ?? [];
          list.push({ occurred_at: award.occurred_at, note: award.note });
          legacyByMember.set(award.member_id, list);
        }
        const mentorshipByMember = metrics.mentorshipByMember ?? new Map<string, MentorshipCount>();
        for (const memberId of new Set([...mentorshipByMember.keys(), ...legacyByMember.keys()])) {
          const member = membersById.get(memberId);
          if (!member) continue;
          const earned: EarnedBadge[] = [];
          pushMentorship(earned, badgeType, levels, mentorshipByMember.get(memberId), legacyByMember.get(memberId) ?? []);
          const badge = earned[0];
          if (!badge) continue;
          recipients.push({
            memberId,
            ...recipientNames(member),
            memberEmail: member.email,
            levelName: badge.levelName,
            level: badge.level,
            occurrences: badge.occurrences,
            firstAwardedAt: badge.firstAwardedAt,
            lastAwardedAt: badge.lastAwardedAt,
            note: badge.note,
          });
        }
        break;
      }
      case "founding_hedgie":
        for (const member of members) {
          if (!isFoundingHedgie(member.firstJoinedAt)) continue;
          recipients.push({
            memberId: member.id,
            ...recipientNames(member),
            memberEmail: member.email,
            levelName: badgeType.name,
            level: null,
            occurrences: 1,
            firstAwardedAt: member.firstJoinedAt,
            lastAwardedAt: member.firstJoinedAt,
            note: null,
          });
        }
        break;
      default:
        if (badgeType.program_id) {
          // `awards` here is already scoped to this one badge type (see getBadgeRecipients),
          // so it's exactly the legacy manual awards to merge with computed completions.
          const completionsByMember =
            metrics.programCompletionsByProgramId.get(badgeType.program_id) ?? new Map<string, ProgramCompletion>();
          const legacyByMember = new Map<string, { occurred_at: string; note: string | null }[]>();
          for (const award of awards) {
            const list = legacyByMember.get(award.member_id) ?? [];
            list.push({ occurred_at: award.occurred_at, note: award.note });
            legacyByMember.set(award.member_id, list);
          }
          for (const memberId of new Set([...completionsByMember.keys(), ...legacyByMember.keys()])) {
            const member = membersById.get(memberId);
            if (!member) continue;
            const completion = completionsByMember.get(memberId);
            const legacy = legacyByMember.get(memberId) ?? [];
            const dates = [
              ...(completion ? [completion.firstCompletedAt, completion.lastCompletedAt] : []),
              ...legacy.map((a) => a.occurred_at),
            ].sort();
            const occurrences = (completion?.occurrences ?? 0) + legacy.length;
            const level = badgeType.has_levels ? deriveLevel(levels, occurrences) : null;
            recipients.push({
              memberId,
              ...recipientNames(member),
              memberEmail: member.email,
              levelName: level?.name ?? badgeType.name,
              level: level?.level ?? null,
              occurrences,
              firstAwardedAt: dates[0],
              lastAwardedAt: dates[dates.length - 1],
              note: legacy[legacy.length - 1]?.note ?? null,
            });
          }
        }
    }
  } else {
    const awardsByMember = new Map<string, { occurred_at: string; note: string | null }[]>();
    for (const award of awards) {
      const list = awardsByMember.get(award.member_id) ?? [];
      list.push({ occurred_at: award.occurred_at, note: award.note });
      awardsByMember.set(award.member_id, list);
    }

    for (const [memberId, memberAwards] of awardsByMember) {
      const member = membersById.get(memberId);
      if (!member) continue; // stale row for a deleted member
      const occurrences = memberAwards.length;
      const sorted = [...memberAwards].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      const level = badgeType.has_levels ? deriveLevel(levels, occurrences) : null;
      recipients.push({
        memberId,
        ...recipientNames(member),
        memberEmail: member.email,
        levelName: level?.name ?? badgeType.name,
        level: level?.level ?? null,
        occurrences,
        firstAwardedAt: sorted[0].occurred_at,
        lastAwardedAt: sorted[sorted.length - 1].occurred_at,
        note: sorted[sorted.length - 1].note,
      });
    }
  }

  recipients.sort((a, b) => a.memberName.localeCompare(b.memberName));
  return recipients;
}

/** Every calendar quarter (UTC) each member hosted at least one prickle, from `prickles.host`
 * -- the bulk counterpart to getHostedQuarterCount, one paginated scan instead of N. */
async function getHostedQuarterCountsByMember(repos: BadgeRepos): Promise<Map<string, number>> {
  const quartersByMember = new Map<string, Set<string>>();
  for (const { hostId, startTime } of await repos.prickles.hostedStartTimes()) {
    const quarters = quartersByMember.get(hostId) ?? new Set<string>();
    quarters.add(quarterKey(startTime));
    quartersByMember.set(hostId, quarters);
  }
  const countsByMember = new Map<string, number>();
  for (const [memberId, quarters] of quartersByMember) countsByMember.set(memberId, quarters.size);
  return countsByMember;
}

/** Number of books each member has logged on the Hedgie Bookshelf -- the bulk counterpart to
 * getPublishedBookCount, one paginated scan instead of N. */
async function getPublishedBookCountsByMember(
  repos: BadgeRepos
): Promise<Map<string, number>> {
  return repos.books.liveCountsByMember();
}

/** Distinct prickles attended by a single member -- the per-member counterpart to
 * getAttendedPrickleCountsByMember, for pages that only need one member's count rather than a
 * bulk scan. Distinct, not records: a member can have several attendance records per prickle
 * from leaving/rejoining (CLAUDE.md). */
export async function getAttendedPrickleCount(
  attendance: AttendanceRepository,
  memberId: string
): Promise<number> {
  return (await attendance.attendedPrickleIds(memberId)).size;
}

/** Distinct prickles attended per member -- the bulk counterpart to the per-member
 * total_sessions figure, one paginated scan instead of N. */
async function getAttendedPrickleCountsByMember(
  attendance: AttendanceRepository
): Promise<Map<string, number>> {
  const countsByMember = new Map<string, number>();
  for (const [memberId, prickleIds] of await attendance.attendedPrickleIdsByMember()) {
    countsByMember.set(memberId, prickleIds.size);
  }
  return countsByMember;
}

/** Big Sister matches per mentor, from mentorship_counts(). Goes through that function because
 * members can't read `mentorships` (it names the mentees); it returns only ids and counts. */
export async function getMentorshipCounts(mentorships: MentorshipRepository): Promise<Map<string, MentorshipCount>> {
  const counts = new Map<string, MentorshipCount>();
  for (const row of await mentorships.counts()) {
    counts.set(row.member_id, {
      count: row.mentored_count,
      firstStartedOn: row.first_started_on,
      lastStartedOn: row.last_started_on,
    });
  }
  return counts;
}

/** Programs `memberId` has completed -- one entry per program_id with at least one enrolled
 * cohort whose expires_at has passed. A member can complete a program more than once (e.g. a
 * repeat 180 alumna enrolling in a later cohort), tracked as multiple occurrences. Enrollment
 * rows per member are few, so this doesn't need CLAUDE.md's pagination loop. */
export async function getProgramCompletions(
  repos: BadgeRepos,
  memberId: string
): Promise<Map<string, ProgramCompletion>> {
  const today = new Date().toISOString().slice(0, 10);
  const completions = new Map<string, ProgramCompletion>();
  for (const e of await repos.programs.enrollmentsOf(memberId)) {
    if (e.expiresAt > today) continue;
    mergeCompletion(completions, e.programId, e.expiresAt);
  }
  return completions;
}

/** Bulk counterpart to getProgramCompletions -- one paginated scan across every member's
 * enrollments instead of N single-member queries, keyed by program_id then member_id. */
async function getProgramCompletionsByProgram(
  repos: BadgeRepos
): Promise<Map<string, Map<string, ProgramCompletion>>> {
  const today = new Date().toISOString().slice(0, 10);
  const byProgram = new Map<string, Map<string, ProgramCompletion>>();
  for (const e of await repos.programs.allEnrollmentCohorts()) {
    if (e.expiresAt > today) continue;
    const byMember = byProgram.get(e.programId) ?? new Map<string, ProgramCompletion>();
    mergeCompletion(byMember, e.memberId, e.expiresAt);
    byProgram.set(e.programId, byMember);
  }
  return byProgram;
}

/** The awards of one badge type in the shape the recipient math reads (member, when, note). */
async function legacyAwardsOf(repos: BadgeRepos, badgeTypeId: string) {
  return (await repos.badges.awardsOfType(badgeTypeId)).map((a) => ({ member_id: a.memberId, occurred_at: a.occurredAt, note: a.note }));
}

/**
 * Every member who has earned a given badge type, across all members -- the reverse of
 * getMemberBadges (which computes one member's badges). Fetches all members plus, depending on
 * whether the badge type is manual or automatic, either its member_badges awards or the bulk
 * automatic-metric scans, then delegates to computeBadgeRecipients. Used by the admin "who has
 * this badge" view.
 */
export async function getBadgeRecipients(
  repos: BadgeRepos,
  badgeType: BadgeType,
  levels: BadgeLevel[]
): Promise<BadgeRecipient[]> {
  const members: RecipientMember[] = (await repos.members.list({ orderBy: "name" })).map((m) => ({
    id: m.id,
    name: m.name,
    displayName: m.displayName,
    email: m.email,
    firstJoinedAt: m.firstJoinedAt,
  }));

  if (!badgeType.is_automatic) {
    return computeBadgeRecipients(
      badgeType,
      levels,
      members,
      await legacyAwardsOf(repos, badgeType.id),
      {
        attendedPrickleCountsByMember: new Map(),
        hostedQuarterCountsByMember: new Map(),
        publishedBookCountsByMember: new Map(),
        programCompletionsByProgramId: new Map(),
      }
    );
  }

  let attendedPrickleCountsByMember = new Map<string, number>();
  let hostedQuarterCountsByMember = new Map<string, number>();
  let publishedBookCountsByMember = new Map<string, number>();
  let programCompletionsByProgramId = new Map<string, Map<string, ProgramCompletion>>();
  // Legacy manual awards for a program-linked badge (pre-dating enrollment tracking), scoped to
  // this one badge type -- computeBadgeRecipients merges these with computed completions.
  let legacyAwards: { member_id: string; occurred_at: string; note: string | null }[] = [];
  let mentorshipByMember = new Map<string, MentorshipCount>();
  switch (badgeType.key) {
    case "prickle_milestones":
      attendedPrickleCountsByMember = await getAttendedPrickleCountsByMember(repos.attendance);
      break;
    case "hostess":
      hostedQuarterCountsByMember = await getHostedQuarterCountsByMember(repos);
      break;
    case "published_author":
      publishedBookCountsByMember = await getPublishedBookCountsByMember(repos);
      break;
    case "hedgie_mentor": {
      mentorshipByMember = await getMentorshipCounts(repos.mentorship);
      legacyAwards = await legacyAwardsOf(repos, badgeType.id);
      break;
    }
    // founding_hedgie needs no query -- it's a pure function of members.firstJoinedAt.
    default:
      if (badgeType.program_id) {
        programCompletionsByProgramId = await getProgramCompletionsByProgram(repos);
        legacyAwards = await legacyAwardsOf(repos, badgeType.id);
      }
  }

  return computeBadgeRecipients(badgeType, levels, members, legacyAwards, {
    attendedPrickleCountsByMember,
    hostedQuarterCountsByMember,
    publishedBookCountsByMember,
    programCompletionsByProgramId,
    mentorshipByMember,
  });
}

/** Fetches every badge_type + badge_levels once (shared across all members on a page), this
 * member's manual award rows, and the query-backed automatic metrics (hosted quarters,
 * published books), then merges them into their earned badges. */
export async function getMemberBadges(
  repos: BadgeRepos,
  memberId: string,
  totalPricklesAttended: number,
  firstJoinedAt: string | null
): Promise<EarnedBadge[]> {
  const badges = repos.badges;
  const [badgeTypes, levels, awards, hostedQuarterCount, publishedBookCount, programCompletions, mentorshipCounts] = await Promise.all([
    badges.types(),
    badges.levels(),
    badges.awardsOf(memberId),
    getHostedQuarterCount(repos, memberId),
    getPublishedBookCount(repos, memberId),
    getProgramCompletions(repos, memberId),
    getMentorshipCounts(repos.mentorship),
  ]);

  const levelsByBadgeType = new Map<string, BadgeLevel[]>();
  for (const level of levels) {
    const list = levelsByBadgeType.get(level.badge_type_id) ?? [];
    list.push(level);
    levelsByBadgeType.set(level.badge_type_id, list);
  }

  return computeEarnedBadges(
    badgeTypes,
    levelsByBadgeType,
    awards.map((a) => ({ badge_type_id: a.badgeTypeId, occurred_at: a.occurredAt, note: a.note })),
    {
      totalPricklesAttended,
      firstJoinedAt,
      hostedQuarterCount,
      publishedBookCount,
      programCompletions,
      mentorship: mentorshipCounts.get(memberId),
    }
  );
}
