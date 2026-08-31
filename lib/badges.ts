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

// "Founding Hedgie" covers members who joined during 2021 or the first quarter of 2022 --
// the org's founding era, per the badge spec ("those who joined in 2021 and maybe early 2022").
export function isFoundingHedgie(firstJoinedAt: string | null): boolean {
  if (!firstJoinedAt) return false;
  const d = parseDateOnly(firstJoinedAt);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  return year === 2021 || (year === 2022 && month <= 2);
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
      }
      continue;
    }

    const typeAwards = awardsByType.get(badgeType.id);
    if (!typeAwards || typeAwards.length === 0) continue;

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

/** Fetches every badge_type + badge_levels once (shared across all members on a page), this
 * member's manual award rows, and the query-backed automatic metrics (hosted quarters,
 * published books), then merges them into their earned badges. */
export async function getMemberBadges(
  supabase: SupabaseClient,
  memberId: string,
  totalPricklesAttended: number,
  firstJoinedAt: string | null
): Promise<EarnedBadge[]> {
  const [{ data: badgeTypes }, { data: levels }, { data: awards }, hostedQuarterCount, publishedBookCount] =
    await Promise.all([
      supabase.from("badge_types").select("*").order("category").order("name"),
      supabase.from("badge_levels").select("*").order("level"),
      supabase
        .from("member_badges")
        .select("badge_type_id, occurred_at, note")
        .eq("member_id", memberId),
      getHostedQuarterCount(supabase, memberId),
      getPublishedBookCount(supabase, memberId),
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
    { totalPricklesAttended, firstJoinedAt, hostedQuarterCount, publishedBookCount }
  );
}
