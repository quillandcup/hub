import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDateOnly } from "@/lib/member-tenure";

export interface BadgeType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  has_levels: boolean;
  is_automatic: boolean;
  program_id: string | null;
}

export interface BadgeLevel {
  id: string;
  badge_type_id: string;
  level: number;
  name: string;
  threshold: number | null;
}

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
}

/** One member's completion history for a single program: how many enrolled cohorts have ended,
 * and the earliest/latest of those end dates. */
export interface ProgramCompletion {
  occurrences: number;
  firstCompletedAt: string;
  lastCompletedAt: string;
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
  supabase: SupabaseClient,
  memberId: string
): Promise<number> {
  const quarters = new Set<string>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickles")
      .select("start_time")
      .eq("host", memberId)
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as { start_time: string }[]) quarters.add(quarterKey(row.start_time));
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return quarters.size;
}

/** Number of books `memberId` has logged on the Hedgie Bookshelf (member_books). */
export async function getPublishedBookCount(
  supabase: SupabaseClient,
  memberId: string
): Promise<number> {
  const { count } = await supabase
    .from("member_books")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);
  return count ?? 0;
}

export interface BadgeRecipient {
  memberId: string;
  memberName: string;
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
    memberName: member.name,
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
      case "founding_hedgie":
        for (const member of members) {
          if (!isFoundingHedgie(member.firstJoinedAt)) continue;
          recipients.push({
            memberId: member.id,
            memberName: member.name,
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
              memberName: member.name,
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
        memberName: member.name,
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
async function getHostedQuarterCountsByMember(supabase: SupabaseClient): Promise<Map<string, number>> {
  const quartersByMember = new Map<string, Set<string>>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickles")
      .select("host, start_time")
      .not("host", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as { host: string; start_time: string }[]) {
        const quarters = quartersByMember.get(row.host) ?? new Set<string>();
        quarters.add(quarterKey(row.start_time));
        quartersByMember.set(row.host, quarters);
      }
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  const countsByMember = new Map<string, number>();
  for (const [memberId, quarters] of quartersByMember) countsByMember.set(memberId, quarters.size);
  return countsByMember;
}

/** Number of books each member has logged on the Hedgie Bookshelf -- the bulk counterpart to
 * getPublishedBookCount, one paginated scan instead of N. */
async function getPublishedBookCountsByMember(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const countsByMember = new Map<string, number>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("member_books")
      .select("member_id")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as { member_id: string }[]) {
        countsByMember.set(row.member_id, (countsByMember.get(row.member_id) ?? 0) + 1);
      }
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return countsByMember;
}

/** Distinct prickle_id count attended by a single member, from `prickle_attendance` -- the
 * per-member counterpart to getAttendedPrickleCountsByMember, for pages that only need one
 * member's count rather than a bulk scan. Mirrors the DISTINCT-prickle_id rule in CLAUDE.md (a
 * member can have multiple attendance rows per prickle from leaving/rejoining). */
export async function getAttendedPrickleCount(
  supabase: SupabaseClient,
  memberId: string
): Promise<number> {
  const prickleIds = new Set<string>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickle_attendance")
      .select("prickle_id")
      .eq("member_id", memberId)
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as { prickle_id: string }[]) {
        prickleIds.add(row.prickle_id);
      }
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return prickleIds.size;
}

/** Distinct prickle_id count attended per member, from `prickle_attendance` -- the bulk
 * counterpart to the per-member total_sessions figure, one paginated scan instead of N. Mirrors
 * the DISTINCT-prickle_id rule in CLAUDE.md (a member can have multiple attendance rows per
 * prickle from leaving/rejoining). */
async function getAttendedPrickleCountsByMember(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const prickleIdsByMember = new Map<string, Set<string>>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickle_attendance")
      .select("member_id, prickle_id")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as { member_id: string; prickle_id: string }[]) {
        const prickleIds = prickleIdsByMember.get(row.member_id) ?? new Set<string>();
        prickleIds.add(row.prickle_id);
        prickleIdsByMember.set(row.member_id, prickleIds);
      }
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  const countsByMember = new Map<string, number>();
  for (const [memberId, prickleIds] of prickleIdsByMember) {
    countsByMember.set(memberId, prickleIds.size);
  }
  return countsByMember;
}

interface EnrollmentCohortRow {
  program_cohorts: { program_id: string; expires_at: string } | null;
}

/** Programs `memberId` has completed -- one entry per program_id with at least one enrolled
 * cohort whose expires_at has passed. A member can complete a program more than once (e.g. a
 * repeat 180 alumna enrolling in a later cohort), tracked as multiple occurrences. Enrollment
 * rows per member are few, so this doesn't need CLAUDE.md's pagination loop. */
export async function getProgramCompletions(
  supabase: SupabaseClient,
  memberId: string
): Promise<Map<string, ProgramCompletion>> {
  const { data } = await supabase
    .from("member_program_enrollments")
    .select("program_cohorts(program_id, expires_at)")
    .eq("member_id", memberId);

  const today = new Date().toISOString().slice(0, 10);
  const completions = new Map<string, ProgramCompletion>();
  for (const row of (data ?? []) as unknown as EnrollmentCohortRow[]) {
    const cohort = row.program_cohorts;
    if (!cohort || cohort.expires_at > today) continue;
    mergeCompletion(completions, cohort.program_id, cohort.expires_at);
  }
  return completions;
}

/** Bulk counterpart to getProgramCompletions -- one paginated scan across every member's
 * enrollments instead of N single-member queries, keyed by program_id then member_id. */
async function getProgramCompletionsByProgram(
  supabase: SupabaseClient
): Promise<Map<string, Map<string, ProgramCompletion>>> {
  const today = new Date().toISOString().slice(0, 10);
  const byProgram = new Map<string, Map<string, ProgramCompletion>>();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("member_program_enrollments")
      .select("member_id, program_cohorts(program_id, expires_at)")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      for (const row of batch as unknown as (EnrollmentCohortRow & { member_id: string })[]) {
        const cohort = row.program_cohorts;
        if (!cohort || cohort.expires_at > today) continue;
        const byMember = byProgram.get(cohort.program_id) ?? new Map<string, ProgramCompletion>();
        mergeCompletion(byMember, row.member_id, cohort.expires_at);
        byProgram.set(cohort.program_id, byMember);
      }
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return byProgram;
}

/**
 * Every member who has earned a given badge type, across all members -- the reverse of
 * getMemberBadges (which computes one member's badges). Fetches all members plus, depending on
 * whether the badge type is manual or automatic, either its member_badges awards or the bulk
 * automatic-metric scans, then delegates to computeBadgeRecipients. Used by the admin "who has
 * this badge" view.
 */
export async function getBadgeRecipients(
  supabase: SupabaseClient,
  badgeType: BadgeType,
  levels: BadgeLevel[]
): Promise<BadgeRecipient[]> {
  const { data: memberRows } = await supabase
    .from("members")
    .select("id, name, email, first_joined_at")
    .order("name");
  const members: RecipientMember[] = (
    (memberRows ?? []) as { id: string; name: string; email: string; first_joined_at: string | null }[]
  ).map((m) => ({ id: m.id, name: m.name, email: m.email, firstJoinedAt: m.first_joined_at }));

  if (!badgeType.is_automatic) {
    const { data: awards } = await supabase
      .from("member_badges")
      .select("member_id, occurred_at, note")
      .eq("badge_type_id", badgeType.id);
    return computeBadgeRecipients(
      badgeType,
      levels,
      members,
      (awards ?? []) as { member_id: string; occurred_at: string; note: string | null }[],
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
  switch (badgeType.key) {
    case "prickle_milestones":
      attendedPrickleCountsByMember = await getAttendedPrickleCountsByMember(supabase);
      break;
    case "hostess":
      hostedQuarterCountsByMember = await getHostedQuarterCountsByMember(supabase);
      break;
    case "published_author":
      publishedBookCountsByMember = await getPublishedBookCountsByMember(supabase);
      break;
    // founding_hedgie needs no query -- it's a pure function of members.firstJoinedAt.
    default:
      if (badgeType.program_id) {
        programCompletionsByProgramId = await getProgramCompletionsByProgram(supabase);
        const { data: awards } = await supabase
          .from("member_badges")
          .select("member_id, occurred_at, note")
          .eq("badge_type_id", badgeType.id);
        legacyAwards = (awards ?? []) as typeof legacyAwards;
      }
  }

  return computeBadgeRecipients(badgeType, levels, members, legacyAwards, {
    attendedPrickleCountsByMember,
    hostedQuarterCountsByMember,
    publishedBookCountsByMember,
    programCompletionsByProgramId,
  });
}

/** Fetches every badge_type + badge_levels once (shared across all members on a page), this
 * member's manual award rows, and the query-backed automatic metrics (hosted quarters,
 * published books), then merges them into their earned badges. */
export async function getMemberBadges(
  supabase: SupabaseClient,
  memberId: string,
  totalPricklesAttended: number,
  firstJoinedAt: string | null
): Promise<EarnedBadge[]> {
  const [{ data: badgeTypes }, { data: levels }, { data: awards }, hostedQuarterCount, publishedBookCount, programCompletions] =
    await Promise.all([
      supabase.from("badge_types").select("*").order("category").order("name"),
      supabase.from("badge_levels").select("*").order("level"),
      supabase
        .from("member_badges")
        .select("badge_type_id, occurred_at, note")
        .eq("member_id", memberId),
      getHostedQuarterCount(supabase, memberId),
      getPublishedBookCount(supabase, memberId),
      getProgramCompletions(supabase, memberId),
    ]);

  const levelsByBadgeType = new Map<string, BadgeLevel[]>();
  for (const level of (levels ?? []) as BadgeLevel[]) {
    const list = levelsByBadgeType.get(level.badge_type_id) ?? [];
    list.push(level);
    levelsByBadgeType.set(level.badge_type_id, list);
  }

  return computeEarnedBadges(
    (badgeTypes ?? []) as BadgeType[],
    levelsByBadgeType,
    (awards ?? []) as { badge_type_id: string; occurred_at: string; note: string | null }[],
    { totalPricklesAttended, firstJoinedAt, hostedQuarterCount, publishedBookCount, programCompletions }
  );
}
