"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LogProgressModal from "@/components/writing/LogProgressModal";
import GoalDisplay from "@/components/writing/GoalDisplay";
import ProjectCharts from "@/components/writing/ProjectCharts";
import ReasonBadges from "@/components/ReasonBadges";
import BookFormModal from "@/components/books/BookFormModal";
import { deleteBook } from "@/app/(member)/bookshelf/actions";
import {
  WRITING_MEASURES,
  MEASURE_LABELS,
  MANUALLY_SETTABLE_PHASES,
  PHASE_LABELS,
  type WritingMeasure,
  type HabitPeriod,
} from "@/lib/writing-projects";
import {
  archiveGoal,
  createGoal,
  deleteEntry,
  deleteGoal,
  getPrickleAnchorOptions,
  toggleGoalStar,
  toggleProjectVisibility,
  updateGoal,
  updateProjectPhase,
  type AnchorOption,
  type WritingProjectRow,
  type EntryRow,
  type GoalRow,
} from "../actions";

interface ProjectDetailClientProps {
  project: WritingProjectRow;
  entries: EntryRow[];
  archivedGoals: GoalRow[];
}

export default function ProjectDetailClient({ project, entries, archivedGoals }: ProjectDetailClientProps) {
  const [showLogProgress, setShowLogProgress] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalRow | null>(null);
  const [showOnProfile, setShowOnProfile] = useState(project.showOnProfile);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [phase, setPhase] = useState(project.phase);
  const [phasePending, setPhasePending] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showEditBook, setShowEditBook] = useState(false);
  const [removingBook, setRemovingBook] = useState(false);

  function handleChanged() {
    // Server actions already revalidatePath(); a full page refresh picks up
    // fresh server data (same approach as ProjectsClient/HostingScheduleManager).
    window.location.reload();
  }

  async function handleDelete(entryId: string) {
    const result = await deleteEntry(entryId);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    handleChanged();
  }

  async function handleDeleteGoal(goalId: string) {
    if (!confirm("Delete this goal? This can't be undone.")) return;
    const result = await deleteGoal(goalId);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    handleChanged();
  }

  async function handleArchiveGoal(goalId: string) {
    const result = await archiveGoal(goalId);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    handleChanged();
  }

  async function handleToggleVisibility() {
    const next = !showOnProfile;
    setVisibilityPending(true);
    const result = await toggleProjectVisibility(project.id, next);
    setVisibilityPending(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    setShowOnProfile(next);
  }

  async function handlePhaseChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as (typeof MANUALLY_SETTABLE_PHASES)[number];
    setPhasePending(true);
    const result = await updateProjectPhase(project.id, next);
    setPhasePending(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    setPhase(next);
  }

  async function handleRemoveBook() {
    if (!project.book) return;
    if (!confirm(`Remove "${project.book.title}" from the Bookshelf?`)) return;
    setRemovingBook(true);
    const result = await deleteBook(project.book.id);
    setRemovingBook(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    handleChanged();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnProfile}
              disabled={visibilityPending}
              onChange={handleToggleVisibility}
              className="rounded"
            />
            Show on my profile
          </label>
          {!project.book && (
            <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              Status
              <select
                value={phase}
                disabled={phasePending}
                onChange={handlePhaseChange}
                className="px-2 py-1 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm disabled:opacity-50"
              >
                {MANUALLY_SETTABLE_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <a
          href={`/api/projects/export?projectId=${project.id}`}
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          ⬇ Export CSV
        </a>
      </div>

      {project.book ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 flex gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size Supabase Storage upload, not optimizable by next/image */}
          <img
            src={project.book.coverUrl}
            alt={`Cover of ${project.book.title}`}
            className="w-16 h-24 object-cover rounded flex-shrink-0 bg-slate-100 dark:bg-slate-800"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
              Published
            </h2>
            <a
              href={project.book.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline"
            >
              {project.book.title}
            </a>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="capitalize">{project.book.format}</span>
              {project.book.genre && <span>· {project.book.genre}</span>}
              {project.book.price != null && <span>· ${project.book.price.toFixed(2)}</span>}
            </p>
            <p className="text-xs mt-2">
              <Link href="/bookshelf" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
                View on the Bookshelf
              </Link>
            </p>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => setShowEditBook(true)}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleRemoveBook}
              disabled={removingBook}
              className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              {removingBook ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowPublish(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            🚀 Publish
          </button>
        </div>
      )}

      {project.goals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Goals</h2>
          {project.goals.map((goal) =>
            editingGoal?.id === goal.id ? (
              <GoalForm
                key={goal.id}
                projectId={project.id}
                goal={editingGoal}
                onSaved={() => {
                  setEditingGoal(null);
                  handleChanged();
                }}
                onCancel={() => setEditingGoal(null)}
                onArchive={() => {
                  setEditingGoal(null);
                  handleArchiveGoal(goal.id);
                }}
              />
            ) : (
              <div key={goal.id} className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const result = await toggleGoalStar(goal.id, !goal.isStarred);
                    if ("error" in result) alert(result.error);
                    else handleChanged();
                  }}
                  title={goal.isStarred ? "Unstar (remove from dashboard)" : "Star (show on dashboard)"}
                  className="flex-shrink-0 mt-1 text-lg leading-none"
                >
                  {goal.isStarred ? "⭐" : "☆"}
                </button>
                <div className="flex-1">
                  <GoalDisplay goal={goal} />
                </div>
                <div className="flex-shrink-0 flex items-center gap-3 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGoal(goal);
                      setShowNewGoal(false);
                    }}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label="Edit goal"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteGoal(goal.id)}
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    aria-label="Delete goal"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {archivedGoals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Past goals</h2>
          {archivedGoals.map((goal) => (
            <div key={goal.id}>
              <GoalDisplay goal={goal} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setShowNewGoal((v) => !v);
            setEditingGoal(null);
          }}
          className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
        >
          {showNewGoal ? "Cancel" : "+ Add a goal"}
        </button>
        <button
          type="button"
          onClick={() => setShowLogProgress(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          + Log progress
        </button>
      </div>

      {showNewGoal && <GoalForm projectId={project.id} onSaved={handleChanged} onCancel={() => setShowNewGoal(false)} />}

      {entries.length > 0 && <ProjectCharts entries={entries} />}

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide p-5 pb-0">
          Entries
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 p-5">
            No entries yet -- log your first one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-800 first:border-0">
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{entry.entryDate}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {entry.mode === "set_total" ? "=" : entry.amount >= 0 ? "+" : ""}
                      {entry.amount.toLocaleString()}
                    </span>{" "}
                    <span className="text-slate-500 dark:text-slate-400">{MEASURE_LABELS[entry.measure]}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-slate-400 truncate max-w-xs">
                    {entry.note}
                    {entry.tags.length > 0 && (
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        {entry.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setEditingEntry(entry)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mr-3"
                      aria-label="Edit entry"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      aria-label="Delete entry"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LogProgressModal
        isOpen={showLogProgress}
        onClose={() => setShowLogProgress(false)}
        projects={[{ id: project.id, title: project.title }]}
        defaultProjectId={project.id}
        onSaved={handleChanged}
      />

      {editingEntry && (
        <LogProgressModal
          isOpen={!!editingEntry}
          onClose={() => setEditingEntry(null)}
          projects={[{ id: project.id, title: project.title }]}
          editingEntry={editingEntry}
          onSaved={handleChanged}
        />
      )}

      {showPublish && (
        <BookFormModal
          isOpen={showPublish}
          onClose={() => setShowPublish(false)}
          onSaved={handleChanged}
          projectId={project.id}
          projectTitle={project.title}
        />
      )}

      {showEditBook && project.book && (
        <BookFormModal
          isOpen={showEditBook}
          onClose={() => setShowEditBook(false)}
          onSaved={handleChanged}
          book={project.book}
        />
      )}
    </div>
  );
}

const HABIT_PERIODS: { value: HabitPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function GoalForm({
  projectId,
  goal,
  onSaved,
  onCancel,
  onArchive,
}: {
  projectId: string;
  goal?: GoalRow;
  onSaved: () => void;
  onCancel?: () => void;
  onArchive?: () => void;
}) {
  const isEditing = !!goal;
  const [goalType, setGoalType] = useState<"target" | "habit">(goal?.kind ?? "target");
  // Prickles is the default for new goals -- it's the input (attending), word/page/etc counts
  // are outputs, so the form leads with the thing that causes the others.
  const [measure, setMeasure] = useState<WritingMeasure>(goal?.measure ?? "prickles");
  const [targetAmount, setTargetAmount] = useState(goal?.kind === "target" ? String(goal.targetAmount) : "");
  const [startDate, setStartDate] = useState(goal?.kind === "target" ? goal.startDate ?? "" : "");
  const [endDate, setEndDate] = useState(goal?.kind === "target" ? goal.endDate ?? "" : "");
  const [habitPeriod, setHabitPeriod] = useState<HabitPeriod>(goal?.kind === "habit" ? goal.habitPeriod : "week");
  const [habitThreshold, setHabitThreshold] = useState(
    goal?.kind === "habit" && goal.habitThreshold != null ? String(goal.habitThreshold) : ""
  );
  // undefined = anchor not touched by this edit -- server keeps whatever's already stored.
  // Editing a goal that already has an anchor starts collapsed (see AnchorPicker below) so a
  // threshold/period-only edit can't accidentally re-derive/clear the anchor.
  const [anchorScheduleId, setAnchorScheduleId] = useState<string | null | undefined>(undefined);
  const [anchorTouched, setAnchorTouched] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const anchorPayload = measure === "prickles" && (!isEditing || anchorTouched) ? anchorScheduleId ?? null : undefined;

    setIsPending(true);
    const result =
      goalType === "target"
        ? await (async () => {
            const parsed = Number(targetAmount);
            if (!targetAmount.trim() || Number.isNaN(parsed) || parsed <= 0) {
              return { error: "Enter a target amount greater than 0" };
            }
            const payload = {
              measure,
              goalType: "target" as const,
              targetAmount: parsed,
              startDate: startDate || null,
              endDate: endDate || null,
              anchorScheduleId: anchorPayload,
            };
            return isEditing ? updateGoal(goal.id, payload) : createGoal({ projectId, ...payload });
          })()
        : await (() => {
            const payload = {
              measure,
              goalType: "habit" as const,
              habitPeriod,
              habitThreshold: habitThreshold.trim() ? Number(habitThreshold) : null,
              anchorScheduleId: anchorPayload,
            };
            return isEditing ? updateGoal(goal.id, payload) : createGoal({ projectId, ...payload });
          })();
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-3"
    >
      <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => setGoalType("target")}
          className={`px-3 py-1.5 text-sm font-medium ${
            goalType === "target" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          }`}
        >
          Target
        </button>
        <button
          type="button"
          onClick={() => setGoalType("habit")}
          className={`px-3 py-1.5 text-sm font-medium ${
            goalType === "habit" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          }`}
        >
          Habit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Measure</label>
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value as WritingMeasure)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          >
            {WRITING_MEASURES.map((m) => (
              <option key={m} value={m}>
                {MEASURE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        {goalType === "target" ? (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Target amount</label>
            <input
              type="number"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="e.g. 50000"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Period</label>
            <select
              value={habitPeriod}
              onChange={(e) => setHabitPeriod(e.target.value as HabitPeriod)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              {HABIT_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {goalType === "target" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Start date <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              End date <span className="text-slate-400 font-normal">(optional, enables a pace line)</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Threshold per period <span className="text-slate-400 font-normal">(optional -- blank means &quot;logged anything counts&quot;)</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={habitThreshold}
            onChange={(e) => setHabitThreshold(e.target.value)}
            placeholder="e.g. 500"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>
      )}

      {measure === "prickles" &&
        (isEditing && !anchorTouched ? (
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {goal?.anchorLabel ? (
              <>
                Anchored to: <span className="font-medium text-slate-900 dark:text-slate-100">{goal.anchorLabel}</span>
              </>
            ) : (
              "Counts any writing prickle attended"
            )}{" "}
            <button
              type="button"
              onClick={() => setAnchorTouched(true)}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 underline"
            >
              Change
            </button>
          </div>
        ) : (
          <AnchorPicker
            value={anchorScheduleId ?? null}
            onChange={(id) => {
              setAnchorScheduleId(id);
              setAnchorTouched(true);
            }}
          />
        ))}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        {isEditing && onArchive ? (
          <button
            type="button"
            onClick={onArchive}
            className="text-sm text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
            title="Mark as done (keeps the record, removes from active goals)"
          >
            ✅ Mark as done
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isEditing ? (isPending ? "Saving..." : "Save changes") : isPending ? "Adding..." : "Add goal"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Ranked, searchable, badged picker over this month/next month's confirmed writing-purpose
 * prickle_schedules -- with 50+ options in a given month, a plain <select> doesn't scale.
 * Ranking/badges are computed server-side (getPrickleAnchorOptions) reusing the exact same
 * hosting/streak/lostStreak priority scheme and ReasonBadges component as the dashboard's
 * "Upcoming Prickles" list -- this only does client-side text filtering over the already-ranked
 * list, since a month or two of schedules is small enough to filter instantly in the browser.
 */
function AnchorPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [options, setOptions] = useState<AnchorOption[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPrickleAnchorOptions().then((opts) => {
      if (!cancelled) setOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = options?.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) ?? [];

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
        Which prickle? <span className="text-slate-400 font-normal">(optional -- leave on &quot;any writing prickle&quot; to count any)</span>
      </label>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by type or host…"
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm mb-2"
      />
      <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left ${
            value === null ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}
        >
          <span className="text-slate-900 dark:text-slate-100">Any writing prickle</span>
        </button>
        {options === null ? (
          <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No matching scheduled prickles.</p>
        ) : (
          filtered.map((o) => (
            <button
              key={o.scheduleId}
              type="button"
              onClick={() => onChange(o.scheduleId)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left ${
                value === o.scheduleId ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <span className="text-slate-900 dark:text-slate-100">{o.label}</span>
              <ReasonBadges reasons={o.reasons} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
