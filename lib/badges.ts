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

/**
 * Merges manually-awarded badges (member_badges rows) with the automatically-computed ones
 * (prickle milestones, Founding Hedgie) into one earned-badges list, ready to render.
 *
 * `totalPricklesAttended` and `firstJoinedAt` feed the automatic badges -- callers already have
 * these on hand (member_metrics.total_sessions, members.first_joined_at) so this stays a pure
 * function rather than issuing its own queries for them.
 */
export function computeEarnedBadges(
  badgeTypes: BadgeType[],
  levelsByBadgeType: Map<string, BadgeLevel[]>,
  awards: { badge_type_id: string; occurred_at: string; note: string | null }[],
  totalPricklesAttended: number,
  firstJoinedAt: string | null
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
      if (badgeType.key === "prickle_milestones") {
        const level = deriveLevel(levels, totalPricklesAttended);
        if (level) {
          earned.push({
            badgeType,
            levelName: level.name,
            level: level.level,
            occurrences: totalPricklesAttended,
            firstAwardedAt: null,
            lastAwardedAt: null,
            note: null,
          });
        }
      } else if (badgeType.key === "founding_hedgie") {
        if (isFoundingHedgie(firstJoinedAt)) {
          earned.push({
            badgeType,
            levelName: badgeType.name,
            level: null,
            occurrences: 1,
            firstAwardedAt: firstJoinedAt,
            lastAwardedAt: firstJoinedAt,
            note: null,
          });
        }
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

/** Fetches every badge_type + badge_levels once (shared across all members on a page) plus
 * this member's manual award rows, and merges them into their earned badges. */
export async function getMemberBadges(
  supabase: SupabaseClient,
  memberId: string,
  totalPricklesAttended: number,
  firstJoinedAt: string | null
): Promise<EarnedBadge[]> {
  const [{ data: badgeTypes }, { data: levels }, { data: awards }] = await Promise.all([
    supabase.from("badge_types").select("*").order("category").order("name"),
    supabase.from("badge_levels").select("*").order("level"),
    supabase
      .from("member_badges")
      .select("badge_type_id, occurred_at, note")
      .eq("member_id", memberId),
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
    totalPricklesAttended,
    firstJoinedAt
  );
}
