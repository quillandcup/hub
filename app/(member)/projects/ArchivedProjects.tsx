"use client";

import { useState } from "react";
import Link from "next/link";
import { MEASURE_LABELS, PHASE_LABELS } from "@/lib/writing-projects";
import { restoreProject, type WritingProjectRow } from "./actions";

/** The projects the member put away, under the list of current ones; "Restore" brings one back. */
export default function ArchivedProjects({ projects }: { projects: WritingProjectRow[] }) {
  const [restoring, setRestoring] = useState<string | null>(null);

  if (projects.length === 0) return null;

  async function handleRestore(projectId: string) {
    setRestoring(projectId);
    const result = await restoreProject(projectId);
    if ("error" in result) {
      setRestoring(null);
      alert(result.error);
      return;
    }
    // The action revalidates /projects; a full refresh picks up the fresh lists (as ProjectsClient does).
    window.location.reload();
  }

  return (
    <details className="max-w-3xl mx-auto mt-6 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
      <summary data-track="projects-archived-toggle" className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-400">
        Archived ({projects.length})
      </summary>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <Link
                data-track="projects-open-archived-project"
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
            </div>
            <button
              type="button"
              data-track="projects-restore-project"
              onClick={() => handleRestore(project.id)}
              disabled={restoring !== null}
              className="flex-shrink-0 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium disabled:opacity-50"
            >
              {restoring === project.id ? "Restoring..." : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
