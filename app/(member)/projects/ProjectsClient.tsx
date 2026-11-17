"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Icon from "@/components/Icon";
import { moveBy } from "@/lib/reorder";
import NewProjectModal from "@/components/writing/NewProjectModal";
import TrackbearImportModal from "@/components/writing/TrackbearImportModal";
import LogProgressModal from "@/components/writing/LogProgressModal";
import PastProjects from "./PastProjects";
import GoalDisplay from "@/components/writing/GoalDisplay";
import BookFormModal from "@/components/books/BookFormModal";
import { MEASURE_LABELS, PHASE_LABELS, isMissedGoal } from "@/lib/writing-projects";
import { reorderMyProjects, type WritingProjectRow } from "./actions";

interface ProjectsClientProps {
  initialProjects: WritingProjectRow[];
  pastProjects?: WritingProjectRow[];
}

const REORDER_FAILED = "Couldn't save the new order. Please try again.";

const ORDER_BUTTON = "flex h-8 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";

/**
 * One active project's card. With two or more projects it has the member's ordering controls: a grip (press and drag it,
 * with a mouse or a finger; Space and the arrow keys work on it too) and Move up / Move down buttons for anyone who
 * can't drag. Only the grip captures touch, so swiping anywhere else on the card still scrolls the page.
 */
function SortableCard({ id, title, index, count, disabled, onMove, children }: { id: string; title: string; index: number; count: number; disabled: boolean; onMove: (delta: -1 | 1) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-project-card={id}
      className={`relative flex gap-3 bg-white dark:bg-slate-900 rounded-lg border p-5 ${
        isDragging ? "z-raised border-plum-400 shadow-xl ring-2 ring-plum-400 dark:border-plum-500 dark:ring-plum-500" : "border-slate-200 dark:border-slate-800"
      }`}
    >
      {count > 1 && (
        <div className="-ml-2 -my-1 flex shrink-0 flex-col items-center justify-center">
          <button type="button" data-track="projects-move-up" aria-label={`Move ${title} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)} className={ORDER_BUTTON}>
            <Icon name="up" className="h-5 w-5" />
          </button>
          <button
            type="button"
            ref={setActivatorNodeRef}
            data-track="projects-drag-handle"
            aria-label={`Reorder ${title}: press space, then the arrow keys, then space again`}
            {...attributes}
            {...listeners}
            className="flex h-11 w-11 touch-none select-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-plum-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-grab active:cursor-grabbing"
          >
            <Icon name="dots" className="h-6 w-6" />
          </button>
          <button type="button" data-track="projects-move-down" aria-label={`Move ${title} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)} className={ORDER_BUTTON}>
            <Icon name="down" className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function ProjectsClient({ initialProjects, pastProjects = [] }: ProjectsClientProps) {
  const router = useRouter();
  const [showNewProject, setShowNewProject] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [logProgressFor, setLogProgressFor] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<WritingProjectRow | null>(null);
  // The order the member just chose, shown at once while it saves. It belongs to the list it was made from: when the page
  // brings a new list (after the save, or any other change) it is dropped, and a failed save drops it too.
  const [chosen, setChosen] = useState<{ base: WritingProjectRow[]; ids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const shown =
    chosen && chosen.base === initialProjects
      ? chosen.ids.map((id) => initialProjects.find((p) => p.id === id)).filter((p): p is WritingProjectRow => !!p)
      : initialProjects;

  async function saveOrder(ids: string[]) {
    setChosen({ base: initialProjects, ids });
    setOrderError(null);
    setSaving(true);
    try {
      const result = await reorderMyProjects(ids);
      if ("error" in result) throw new Error(result.error);
      router.refresh();
    } catch {
      setChosen(null);
      setOrderError(REORDER_FAILED);
    } finally {
      setSaving(false);
    }
  }

  function moveProject(id: string, delta: -1 | 1) {
    const ids = shown.map((p) => p.id);
    const next = moveBy(ids, id, delta);
    if (next === ids) return;
    const title = shown.find((p) => p.id === id)?.title ?? "Project";
    setOrderNote(`${title} moved to position ${next.indexOf(id) + 1} of ${next.length}.`);
    void saveOrder(next);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = shown.map((p) => p.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void saveOrder(arrayMove(ids, from, to));
  }

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

      {orderError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {orderError}
        </p>
      )}
      <p role="status" className="sr-only">
        {orderNote}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={shown.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">
        {shown.map((project, index) => (
          <SortableCard key={project.id} id={project.id} title={project.title} index={index} count={shown.length} disabled={saving} onMove={(delta) => moveProject(project.id, delta)}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
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
              <div className="flex-shrink-0 flex items-center gap-2">
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
          </SortableCard>
        ))}
      </div>
        </SortableContext>
      </DndContext>

      <PastProjects projects={pastProjects} />

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
