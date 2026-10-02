"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogProgressModal from "@/components/writing/LogProgressModal";
import { MEASURE_LABELS } from "@/lib/writing-projects";
import type { PrickleEntryRow } from "@/app/(member)/projects/actions";

interface PrickleWritingPanelProps {
  prickleId: string;
  /** The prickle's local calendar date, for new entries. */
  entryDate: string;
  attended: boolean;
  projects: { id: string; title: string }[];
  entries: PrickleEntryRow[];
}

/** "Your writing in this prickle": what the viewer logged against this prickle, and a way to log more. */
export default function PrickleWritingPanel({ prickleId, entryDate, attended, projects, entries }: PrickleWritingPanelProps) {
  const router = useRouter();
  const [isLogOpen, setIsLogOpen] = useState(false);

  const prompt = attended ? "You were here. What did you work on?" : "Were you here? Log what you worked on.";

  return (
    <section
      aria-labelledby="prickle-writing-heading"
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 id="prickle-writing-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Your writing in this prickle
          </h2>
          {entries.length === 0 && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{prompt}</p>}
        </div>
        {projects.length > 0 ? (
          <button
            type="button"
            onClick={() => setIsLogOpen(true)}
            className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 transition-colors"
          >
            {entries.length === 0 ? "Log progress" : "Log more"}
          </button>
        ) : (
          <Link href="/projects" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline">
            Start tracking your writing →
          </Link>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2 text-sm flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {entry.mode === "set_total" ? "=" : entry.amount >= 0 ? "+" : ""}
                {entry.amount.toLocaleString()} {MEASURE_LABELS[entry.measure]}
              </span>
              <Link
                href={`/projects/${entry.projectId}`}
                className="text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline"
              >
                {entry.projectTitle}
              </Link>
              {entry.note && <span className="text-slate-500 dark:text-slate-400">· {entry.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {projects.length > 0 && isLogOpen && (
        <LogProgressModal
          isOpen={isLogOpen}
          onClose={() => setIsLogOpen(false)}
          projects={projects}
          prickleId={prickleId}
          defaultEntryDate={entryDate}
          onSaved={() => router.refresh()}
        />
      )}
    </section>
  );
}
