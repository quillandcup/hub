import type { EngagementCardData } from "./card";

/** One owner's share of what is overdue. */
export type AttentionRow = { ownerId: string | null; ownerName: string; reviewDue: number; lapsed: number };

export type Attention = { reviewDue: number; lapsed: number; byOwner: AttentionRow[] };

/**
 * How much is overdue, and with whom: engagements whose period ended and wait for a renewal or a close ("review due"), and
 * those that waited past the grace window ("lapsed"). Lapse is derived from the dates, so nothing here is stored or sent;
 * the point is that a capacity problem is visible to everyone who opens the page. Owners with nothing overdue are left out;
 * the most lapsed come first, then the most review due, then by name.
 */
export function careAttention(cards: readonly EngagementCardData[]): Attention {
  const byOwner = new Map<string, AttentionRow>();
  let reviewDue = 0;
  let lapsed = 0;
  for (const card of cards) {
    if (card.status !== "review_due" && card.status !== "lapsed") continue;
    const key = card.ownerId ?? "";
    const row = byOwner.get(key) ?? { ownerId: card.ownerId, ownerName: card.ownerName, reviewDue: 0, lapsed: 0 };
    if (card.status === "lapsed") {
      row.lapsed += 1;
      lapsed += 1;
    } else {
      row.reviewDue += 1;
      reviewDue += 1;
    }
    byOwner.set(key, row);
  }
  return {
    reviewDue,
    lapsed,
    byOwner: [...byOwner.values()].sort((a, b) => b.lapsed - a.lapsed || b.reviewDue - a.reviewDue || a.ownerName.localeCompare(b.ownerName)),
  };
}
