"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SortableList, SortableRow, useReorderableList } from "@/components/writing/SortableList";
import NewProjectModal from "@/components/writing/NewProjectModal";
import TrackbearImportModal from "@/components/writing/TrackbearImportModal";
import LogProgressModal from "@/components/writing/LogProgressModal";
import PastProjects from "./PastProjects";
import GoalDisplay from "@/components/writing/GoalDisplay";
import BookFormModal from "@/components/books/BookFormModal";
import { MEASURE_LABELS, PHASE_LABELS, isMissedGoal } from "@/lib/writing-projects";
import { reorderMyProjects, type WritingProjectRow } from "./actions";
import { MilestoneSummary, OtherWorks, ProjectMilestonesToggle, type MilestoneWebState } from "@/components/writing/Milestones";
import { otherWorks, workOfProject, type Work } from "@/lib/finishers-works";

interface ProjectsClientProps {
  initialProjects: WritingProjectRow[];
  pastProjects?: WritingProjectRow[];
  /** Every work of the member (docs/product/FINISHERS.md): a project's own milestones sit on its card, the rest under "Other works". */
  works?: Work[];
  web?: MilestoneWebState;
  /** Viewing as the member (sudo): milestones can be looked at, not changed. */
  readOnly?: boolean;
}

const REORDER_FAILED = "Couldn't save the new order. Please try again.";

export default function ProjectsClient({ initialProjects, pastProjects = [], works = [], web = { available: false, on: false }, readOnly = false }: ProjectsClientProps) {
  const router = useRouter();
  const [showNewProject, setShowNewProject] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [logProgressFor, setLogProgressFor] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<WritingProjectRow | null>(null);
  const { shown, saving, error: orderError, note: orderNote, moveTo, reorder } = useReorderableList(
    initialProjects,
    (ids) => reorderMyProjects(ids),
    (project) => project.title,
    REORDER_FAILED,
    () => router.refresh()
  );

  const others = otherWorks(works, new Set(initialProjects.map((p) => p.id)));
  const waiting = works.some((w) => Object.values(w.milestones).some((m) => m.status === "proposed"));

  function handleChanged() {
    // Re-render the page's server data in place. Not window.location.reload(): that cancels the server action's
    // response while the browser is still reading it, which Firefox and Safari report as "Error in input stream"
    // / "Load failed" (a crash alert in #hub-alerts), though the project was saved.
    router.refresh();
  }

  if (initialProjects.length === 0 && !showNewProject) {
    return (
      <>
      <div className="max-w-xl mx-auto text-center py-12 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
        <p className="text-4xl mb-3">📝</p>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">Track your first project</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 max-w-sm mx-auto">
          Log words, pages, or time against a project and watch your progress add up.
        </p>
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          data-tour="new-project"
          data-track="projects-new-project"
          className="px-4 py-2 bg-plum-600 hover:bg-plum-700 text-white rounded-lg text-sm font-medium"
        >
          New project
        </button>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">
          Already tracking in TrackBear?{" "}
          <button data-track="projects-import-your-projects"
            type="button"
            onClick={() => setShowImport(true)}
            className="text-plum-600 dark:text-plum-400 hover:underline"
          >
            Import your projects
          </button>
        </p>
        <NewProjectModal isOpen={showNewProject} onClose={() => setShowNewProject(false)} onCreated={handleChanged} />
        <TrackbearImportModal isOpen={showImport} onClose={() => setShowImport(false)} onImported={handleChanged} />
      </div>
      <PastProjects projects={pastProjects} />
      <div className="max-w-3xl mx-auto mt-6 space-y-4">
        <MilestoneSummary works={works} waiting={waiting} />
        <OtherWorks works={others} readOnly={readOnly} web={web} />
      </div>
      </>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowImport(true)}
          data-track="projects-import-trackbear"
          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-sm font-medium"
        >
          Import from TrackBear
        </button>
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          data-tour="new-project"
          data-track="projects-new-project"
          className="px-4 py-2 bg-plum-600 hover:bg-plum-700 text-white rounded-lg text-sm font-medium"
        >
          New project
        </button>
      </div>

      <MilestoneSummary works={works} waiting={waiting} />

      {orderError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {orderError}
        </p>
      )}
      <p role="status" className="sr-only">
        {orderNote}
      </p>
      <SortableList ids={shown.map((p) => p.id)} labels={Object.fromEntries(shown.map((p) => [p.id, p.title]))} onReorder={(ids) => void reorder(ids)}>
      <div className="space-y-4">
        {shown.map((project, index) => (
          <SortableRow
            key={project.id}
            id={project.id}
            label={project.title}
            index={index}
            count={shown.length}
            disabled={saving}
            onMoveTo={(position) => moveTo(project.id, position)}
            track="projects"
            className="bg-white dark:bg-slate-900 rounded-lg border p-5"
            idleClassName="border-slate-200 dark:border-slate-800"
            liftedClassName="border-plum-400 shadow-xl ring-2 ring-plum-400 dark:border-plum-500 dark:ring-plum-500"
          >
            {({ handle, menu }) => (
            <>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-1 basis-44 items-start gap-3">
                {project.book?.coverUrl || project.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- fixed-size Supabase Storage upload, not optimizable by next/image
                  <img
                    src={project.book?.coverUrl ?? project.coverUrl ?? undefined}
                    alt={`Cover of ${project.title}`}
                    className="w-12 h-[4.5rem] object-cover rounded flex-shrink-0 bg-slate-100 dark:bg-slate-800"
                  />
                ) : (
                  <div className="w-12 h-[4.5rem] rounded flex-shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg">
                    📖
                  </div>
                )}
                <div className="min-w-0">
                  <Link data-track="projects-open-project"
                    href={`/projects/${project.id}`}
                    className="text-lg font-semibold text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400"
                  >
                    {project.title}
                  </Link>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {PHASE_LABELS[project.phase] ?? project.phase}
                    {project.book && <span className="ml-2">📚 Published</span>}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                <button data-track="projects-log-progress"
                  type="button"
                  onClick={() => setLogProgressFor(project.id)}
                  className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium"
                >
                  + Log progress
                </button>
                {!project.book && (
                  <button data-track="projects-publish"
                    type="button"
                    onClick={() => setPublishing(project)}
                    className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium"
                  >
                    🚀 Publish
                  </button>
                )}
                <div className="flex items-center">
                  {handle}
                  {menu}
                </div>
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

            {project.goals.some((goal) => !isMissedGoal(goal)) && (
              <div className="mt-4 space-y-3">
                {project.goals.filter((goal) => !isMissedGoal(goal)).map((goal) => (
                  <GoalDisplay key={goal.id} goal={goal} />
                ))}
              </div>
            )}

            {(() => {
              const work = workOfProject(works, project.id);
              return work ? <ProjectMilestonesToggle work={work} readOnly={readOnly} web={web} /> : null;
            })()}
            </>
            )}
          </SortableRow>
        ))}
      </div>
      </SortableList>

      <PastProjects projects={pastProjects} />

      <OtherWorks works={others} readOnly={readOnly} web={web} />

      <NewProjectModal isOpen={showNewProject} onClose={() => setShowNewProject(false)} onCreated={handleChanged} />
      <TrackbearImportModal isOpen={showImport} onClose={() => setShowImport(false)} onImported={handleChanged} />

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
