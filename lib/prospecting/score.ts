import type { ProspectCandidate } from "./candidates";
import { FOLLOWER_RANGE, PROSPECT_RULES, SHORTLIST_THRESHOLD, type ProspectRule } from "./rules";

export type ProspectScore = {
  /** 0-100. */
  score: number;
  /** Why, for the reviewer: each matching rule's label with its weight. */
  reasons: string[];
  suggestShortlist: boolean;
};

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * How well a profile fits, by the rules in `rules.ts`. Deterministic: the same profile always gets
 * the same score and reasons, so a score can be explained and a rule change re-applied to every
 * prospect (`rules` is a parameter for tests).
 */
export function scoreProspect(
  candidate: Pick<ProspectCandidate, "bio" | "hashtags" | "followerCount">,
  rules: ProspectRule[] = PROSPECT_RULES,
): ProspectScore {
  const bio = (candidate.bio ?? "").toLowerCase();
  const tags = new Set(candidate.hashtags.map((t) => t.toLowerCase()));
  let total = 0;
  const reasons: string[] = [];

  for (const rule of rules) {
    const matches = (rule.bio?.test(bio) ?? false) || (rule.hashtags?.some((t) => tags.has(t)) ?? false);
    if (!matches) continue;
    total += rule.weight;
    reasons.push(`${rule.label} (${signed(rule.weight)})`);
  }

  const followers = candidate.followerCount;
  if (followers !== null && (followers < FOLLOWER_RANGE.min || followers > FOLLOWER_RANGE.max)) {
    total += FOLLOWER_RANGE.penalty;
    reasons.push(`${followers.toLocaleString("en-US")} followers is outside the usual range (${signed(FOLLOWER_RANGE.penalty)})`);
  }

  const score = Math.max(0, Math.min(100, total));
  return { score, reasons, suggestShortlist: score >= SHORTLIST_THRESHOLD };
}
