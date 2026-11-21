import { MILESTONE_SHOWN, MILESTONE_TITLES, milestoneDateWords } from "@/lib/finishers";
import type { ShownMilestone } from "@/lib/data/milestones";

/**
 * The "Milestones" strip on a member's profile (for members) and on their writer profile (for the web): one line per
 * milestone, the title it earns (Finisher, Author; docs/product/WRITER_TITLES.md), the work and the day when they gave one, and
 * the story only when they wrote one. The list comes from `milestones_shown_to_members` or `milestones_shown_on_web`, which
 * already hold back everything the viewer may not see, so this only draws what it is given. Plain text: React escapes it, and
 * line breaks are kept by the style. Draws nothing when there is nothing to show.
 */
export default function MilestoneStrip({ milestones, headingClassName }: { milestones: ShownMilestone[]; headingClassName?: string }) {
  if (milestones.length === 0) return null;
  return (
    <section aria-labelledby="milestones-heading" data-testid="milestone-strip">
      <h2 id="milestones-heading" className={headingClassName ?? "text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4"}>
        Milestones
      </h2>
      <ul className="space-y-4">
        {milestones.map((m, i) => {
          const detail = [m.workTitle, m.achievedOn ? milestoneDateWords(m.achievedOn) : null].filter(Boolean).join(" · ");
          return (
            <li key={`${m.kind}-${i}`}>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {MILESTONE_TITLES[m.kind]} · {MILESTONE_SHOWN[m.kind]}
              </p>
              {detail && <p className="text-xs text-slate-600 dark:text-slate-400">{detail}</p>}
              {m.storyBefore && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-300">{m.storyBefore}</p>}
              {m.storyAfter && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-300">{m.storyAfter}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
