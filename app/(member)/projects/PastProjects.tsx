import Link from "next/link";
import { MEASURE_LABELS, PHASE_LABELS } from "@/lib/writing-projects";
import type { WritingProjectRow } from "./actions";

/**
 * The projects that are done (complete, published or abandoned), apart from the ongoing ones. Each
 * opens as usual; changing its status on its page brings it back to the main list.
 */
export default function PastProjects({ projects }: { projects: WritingProjectRow[] }) {
  if (projects.length === 0) return null;

  return (
    <details className="max-w-3xl mx-auto mt-6 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
      <summary data-track="projects-past-toggle" className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-400">
        Past projects ({projects.length})
      </summary>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
        {projects.map((project) => (
          <li key={project.id} className="px-5 py-3">
            <Link
              data-track="projects-open-past-project"
              href={`/projects/${project.id}`}
              className="font-medium text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400"
            >
              {project.title}
            </Link>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {PHASE_LABELS[project.phase] ?? project.phase}
              {Object.entries(project.totalsByMeasure).map(([measure, total]) => (
                <span key={measure}>
                  {" · "}
                  {total!.toLocaleString()} {MEASURE_LABELS[measure as keyof typeof MEASURE_LABELS].toLowerCase()}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
