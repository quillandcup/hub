"use client";

import { useState } from "react";
import LogProgressModal from "@/components/writing/LogProgressModal";
import GoalProgressBar from "@/components/writing/GoalProgressBar";
import { WRITING_MEASURES, MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";
import { createGoal, deleteEntry, toggleGoalStar, type WritingProjectRow, type EntryRow } from "../actions";

interface ProjectDetailClientProps {
  project: WritingProjectRow;
  entries: EntryRow[];
}

export default function ProjectDetailClient({ project, entries }: ProjectDetailClientProps) {
  const [showLogProgress, setShowLogProgress] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);
  const [showNewGoal, setShowNewGoal] = useState(false);

  function handleChanged() {
    // Server actions already revalidatePath(); a full page refresh picks up
    // fresh server data (same approach as WritingProjectsClient/HostingScheduleManager).
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {project.goals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Goals</h2>
          {project.goals.map((goal) => (
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
                <GoalProgressBar
                  measure={goal.measure}
                  current={goal.current}
                  target={goal.targetAmount}
                  percent={goal.percent}
                  parTarget={goal.parTarget}
                  onPace={goal.onPace}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowNewGoal((v) => !v)}
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

      {showNewGoal && <NewGoalForm projectId={project.id} onCreated={handleChanged} />}

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
                  <td className="px-5 py-3 text-slate-500 dark:text-slate-400 truncate max-w-xs">{entry.note}</td>
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
    </div>
  );
}

function NewGoalForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [measure, setMeasure] = useState<WritingMeasure>("words");
  const [targetAmount, setTargetAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = Number(targetAmount);
    if (!targetAmount.trim() || Number.isNaN(parsed) || parsed <= 0) {
      setError("Enter a target amount greater than 0");
      return;
    }

    setIsPending(true);
    const result = await createGoal({
      projectId,
      measure,
      targetAmount: parsed,
      startDate: startDate || null,
      endDate: endDate || null,
    });
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCreated();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-3"
    >
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
      </div>

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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? "Adding..." : "Add goal"}
        </button>
      </div>
    </form>
  );
}
