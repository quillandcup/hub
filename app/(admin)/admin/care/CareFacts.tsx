import { CARE_SCORE_TIER_LABELS } from "@/lib/care-scores";
import type { EngagementCardData } from "./card";

/** What the score counts, word for word as the code does (`lib/member-engagement.ts`). */
export const SCORE_HELP =
  "Points for what the member did in the 30 days before the day shown, never more than 100. A prickle is worth 10; other activity is worth a few points each. Under 10 is at risk, 10 to 49 is active, 50 or more is highly engaged. Then is the day the care period started. Now is today.";

/** What \"last in the community\" counts, word for word as the code does (`lib/care-participation.ts`). */
export const PARTICIPATION_HELP =
  "The latest thing the member did themselves anywhere in the community: a prickle, a Slack message or reaction, a lesson, a check-in or check-out, a prickle commitment or a writing log. Not signing in, and nothing staff or the Hub did.";

/** "18 (At risk) then, 42 (Active) now" for the row and the results. */
export function scoreSentence(scores: NonNullable<EngagementCardData["scores"]>): string {
  const part = (s: { score: number; tier: keyof typeof CARE_SCORE_TIER_LABELS }) => `${s.score} (${CARE_SCORE_TIER_LABELS[s.tier]})`;
  return `${part(scores.then)} when the care period started, ${part(scores.now)} now`;
}

/**
 * The two facts she used to type into the note: the member's engagement score when the care period started and now, and the
 * last time they took part in the community. Neither is the DM: who spoke last is shown on its own line, labelled "Last
 * message".
 */
export default function CareFacts({ card, withHelp = false }: { card: Pick<EngagementCardData, "scores" | "lastParticipation">; withHelp?: boolean }) {
  const { scores, lastParticipation } = card;
  return (
    <div className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
      <p>
        <span title={SCORE_HELP} className="cursor-help underline decoration-dotted underline-offset-2">
          Engagement score
        </span>
        : {scores ? scoreSentence(scores) : "not available"}
      </p>
      <p>
        <span title={PARTICIPATION_HELP} className="cursor-help underline decoration-dotted underline-offset-2">
          Last in the community
        </span>
        : {lastParticipation === "unavailable" ? "not available" : lastParticipation ? `${lastParticipation.dateLabel}, ${lastParticipation.what} (${lastParticipation.agoLabel})` : "none recorded"}
      </p>
      {withHelp && (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-400">{SCORE_HELP}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{PARTICIPATION_HELP}</p>
        </>
      )}
    </div>
  );
}
