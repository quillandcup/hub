"use client";

import { useState } from "react";
import Link from "next/link";
import NewProjectModal from "@/components/writing/NewProjectModal";
import LogProgressModal from "@/components/writing/LogProgressModal";
import GoalDisplay from "@/components/writing/GoalDisplay";
import BookFormModal from "@/components/books/BookFormModal";
import { MEASURE_LABELS, PHASE_LABELS } from "@/lib/writing-projects";
import type { WritingProjectRow } from "./actions";

interface ProjectsClientProps {
  initialProjects: WritingProjectRow[];
}

export default function ProjectsClient({ initialProjects }: ProjectsClientProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [logProgressFor, setLogProgressFor] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<WritingProjectRow | null>(null);

  function handleChanged() {
    // Server actions already revalidatePath('/projects'); a full page refresh
    // picks up fresh server data (same approach as HostingScheduleManager).
    window.location.reload();
  }

  if (initialProjects.length === 0 && !showNewProject) {
    return (
      <div className="max-w-xl mx-auto text-center py-12 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
        <p className="text-4xl mb-3">📝</p>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">Track your first project</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm mx-auto">
          Log words, pages, or time against a project and watch your progress add up.
        </p>
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          New project
        </button>
        <NewProjectModal isOpen={showNewProject} onClose={() => setShowNewProject(false)} onCreated={handleChanged} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          New project
        </button>
      </div>

      <div className="space-y-4">
        {initialProjects.map((project) => (
          <div
            key={project.id}
            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/projects/${project.id}`}
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {project.title}
                </Link>
                <p className="text-xs text-slate-400 mt-0.5">
                  {PHASE_LABELS[project.phase] ?? project.phase}
                  {project.book && <span className="ml-2">📚 Published</span>}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogProgressFor(project.id)}
                  className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium"
                >
                  + Log progress
                </button>
                {!project.book && (
                  <button
                    type="button"
                    onClick={() => setPublishing(project)}
                    className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium"
                  >
                    🚀 Publish
                  </button>
                )}
              </div>
            </div>

            {Object.keys(project.totalsByMeasure).length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-slate-600 dark:text-slate-400">
                {Object.entries(project.totalsByMeasure).map(([measure, total]) => (
                  <span key={measure}>
                    <strong className="text-slate-900 dark:text-slate-100">{total!.toLocaleString()}</strong>{" "}
                    {MEASURE_LABELS[measure as keyof typeof MEASURE_LABELS].toLowerCase()}
                  </span>
                ))}
              </div>
            )}

            {project.goals.length > 0 && (
              <div className="mt-4 space-y-3">
                {project.goals.map((goal) => (
                  <GoalDisplay key={goal.id} goal={goal} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <NewProjectModal isOpen={showNewProject} onClose={() => setShowNewProject(false)} onCreated={handleChanged} />

      {logProgressFor && (
        <LogProgressModal
          isOpen={!!logProgressFor}
          onClose={() => setLogProgressFor(null)}
          projects={initialProjects.map((p) => ({ id: p.id, title: p.title }))}
          defaultProjectId={logProgressFor}
          onSaved={handleChanged}
        />
      )}

      {publishing && (
        <BookFormModal
          isOpen={!!publishing}
          onClose={() => setPublishing(null)}
          onSaved={handleChanged}
          projectId={publishing.id}
          projectTitle={publishing.title}
        />
      )}
    </div>
  );
}
