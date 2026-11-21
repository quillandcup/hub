import { MILESTONE_SHOWN, MILESTONE_TITLES, PUBLISHED_SHOWN, PUBLISHED_TITLE, milestoneDateWords } from "@/lib/finishers";
import { groupShownWorks } from "@/lib/finishers-works";
import type { ShownStepKind, ShownWorkStep } from "@/lib/data/milestones";

const STEP_TITLE: Record<ShownStepKind, string> = { ...MILESTONE_TITLES, published: PUBLISHED_TITLE };
const STEP_SHOWN: Record<ShownStepKind, string> = { ...MILESTONE_SHOWN, published: PUBLISHED_SHOWN };

/**
 * The "Milestones" strip on a member's profile (for members) and on their writer profile (for the web): each work, with the steps
 * it has reached in order (THE END, publish-ready, Published), the title each earns (Finisher, Author, Published Author;
 * docs/product/WRITER_TITLES.md), the day when they gave one, and the story only when they wrote one. Published comes from the
 * Bookshelf and is always at the globe. The rows come from `member_works_shown_to_members` or `member_works_shown_on_web`, which
 * already hold back everything the viewer may not see, so this only draws what it is given. Plain text: React escapes it, and
 * line breaks are kept by the style. Draws nothing when there is nothing to show.
 */
export default function MilestoneStrip({ steps, headingClassName }: { steps: ShownWorkStep[]; headingClassName?: string }) {
  const works = groupShownWorks(steps);
  if (works.length === 0) return null;
  return (
    <section aria-labelledby="milestones-heading" data-testid="milestone-strip">
      <h2 id="milestones-heading" className={headingClassName ?? "text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4"}>
        Milestones
      </h2>
      <ul className="space-y-6">
        {works.map((work, w) => (
          <li key={w} data-testid="milestone-work">
            {work.title && <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{work.title}</h3>}
            <ul className="space-y-3">
              {work.steps.map((step) => (
                <li key={step.kind}>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {STEP_TITLE[step.kind]} · {STEP_SHOWN[step.kind]}
                  </p>
                  {step.achievedOn && <p className="text-xs text-slate-600 dark:text-slate-400">{milestoneDateWords(step.achievedOn)}</p>}
                  {step.storyBefore && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-300">{step.storyBefore}</p>}
                  {step.storyAfter && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-300">{step.storyAfter}</p>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
