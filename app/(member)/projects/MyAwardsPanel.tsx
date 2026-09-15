"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AwardFormModal from "@/components/awards/AwardFormModal";
import { deleteAward, type MyAwardRow } from "@/app/(member)/awards/actions";
import type { MyBookRow } from "@/app/(member)/bookshelf/actions";

interface MyAwardsPanelProps {
  initialAwards: MyAwardRow[];
  myBooks: MyBookRow[];
}

function formatDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Self-service "did you win something?" panel -- see docs/TODO.md "Awards & Competition
 * Tracking" Phase 1. Members share wins informally in #hedgie-classifieds today; this is the
 * first structured place to record one, mirroring MyBooksPanel's shape. */
export default function MyAwardsPanel({ initialAwards, myBooks }: MyAwardsPanelProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editingAward, setEditingAward] = useState<MyAwardRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleSaved() {
    router.refresh();
  }

  async function handleDelete(award: MyAwardRow) {
    if (!confirm(`Remove "${award.awardName}" from your awards?`)) return;
    setDeletingId(award.id);
    const result = await deleteAward(award.id);
    setDeletingId(null);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          My Awards
        </h2>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          + Add an award
        </button>
      </div>

      {initialAwards.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Won something? A contest, a competition, an anthology feature — let us know so we can celebrate it.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {initialAwards.map((award) => (
            <li key={award.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  🏆 {award.awardName}
                  {award.category && <span className="font-normal text-slate-500 dark:text-slate-400"> — {award.category}</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  for &ldquo;{award.workTitle}&rdquo; · {formatDate(award.awardDate)}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingAward(award)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(award)}
                  disabled={deletingId === award.id}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  {deletingId === award.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AwardFormModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSaved={handleSaved} myBooks={myBooks} />
      {editingAward && (
        <AwardFormModal
          isOpen={true}
          onClose={() => setEditingAward(null)}
          onSaved={handleSaved}
          award={editingAward}
          myBooks={myBooks}
        />
      )}
    </div>
  );
}
