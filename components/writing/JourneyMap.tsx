import Link from "next/link";
import { JOURNEY_OFFER_LABELS, JOURNEY_STAGES, journeyStageForPhase } from "@/lib/writing-journey";
import { PHASE_LABELS, type ProjectPhase } from "@/lib/writing-projects";

export interface JourneyProject {
  id: string;
  title: string;
  phase: ProjectPhase;
}

/** Spark to Shelf: the stages a book goes through, with the member's projects at the stage they are on. */
export default function JourneyMap({ projects }: { projects: JourneyProject[] }) {
  const paused = projects.filter((p) => !journeyStageForPhase(p.phase));

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The stages a book goes through at Quill &amp; Cup, and what we offer at each. Your projects sit at the stage their status puts them.
      </p>
      <ol className="space-y-3">
        {JOURNEY_STAGES.map((stage, i) => {
          const here = projects.filter((p) => stage.phases.includes(p.phase));
          return (
            <li key={stage.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                  <span className="mr-2 text-slate-400">{i + 1}</span>
                  {stage.title}
                </h2>
                <span className="text-xs text-slate-500">{JOURNEY_OFFER_LABELS[stage.offerStatus]}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-plum-700 dark:text-plum-400">{stage.offer}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{stage.description}</p>
              {here.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {here.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="inline-block rounded-full bg-plum-50 dark:bg-plum-900/30 px-3 py-1 text-sm text-plum-700 dark:text-plum-300 hover:underline">
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {paused.length > 0 && (
        <section>
          <h2 className="font-semibold">Paused</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {paused.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-sm hover:underline">
                  {p.title} · {PHASE_LABELS[p.phase]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
