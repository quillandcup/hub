"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { addAward, updateAward, type AwardInput, type MyAwardRow } from "@/app/(member)/awards/actions";
import type { MyBookRow } from "@/app/(member)/bookshelf/actions";

interface AwardFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Present for edit, absent for add. */
  award?: MyAwardRow;
  /** The member's own books, offered as an optional link to the piece that won. */
  myBooks: MyBookRow[];
}

export default function AwardFormModal({ isOpen, onClose, onSaved, award, myBooks }: AwardFormModalProps) {
  const [awardName, setAwardName] = useState(award?.awardName ?? "");
  const [category, setCategory] = useState(award?.category ?? "");
  const [workTitle, setWorkTitle] = useState(award?.workTitle ?? "");
  const [bookId, setBookId] = useState(award?.bookId ?? "");
  const [awardDate, setAwardDate] = useState(award?.awardDate ?? "");
  const [url, setUrl] = useState(award?.url ?? "");
  const [notes, setNotes] = useState(award?.notes ?? "");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleBookChange(selectedId: string) {
    setBookId(selectedId);
    // Prefill the work title from the linked book unless the member already typed one.
    if (selectedId && !workTitle.trim()) {
      const book = myBooks.find((b) => b.id === selectedId);
      if (book) setWorkTitle(book.title);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const input: AwardInput = {
      awardName,
      category,
      workTitle,
      bookId: bookId || null,
      awardDate,
      url,
      notes,
    };

    setIsPending(true);
    const result = award ? await updateAward(award.id, input) : await addAward(input);
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={award ? "Edit Award" : "Add an Award"} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Award / competition name *
          </label>
          <input
            type="text"
            value={awardName}
            onChange={(e) => setAwardName(e.target.value)}
            placeholder="IPPY Awards, Query Kombat, ..."
            autoFocus
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Category or placement (optional)
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Gold Medal — Romance, Grand Prize, Finalist, ..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        {myBooks.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Link to one of your books (optional)
            </label>
            <select
              value={bookId}
              onChange={(e) => handleBookChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              <option value="">Not one of my Bookshelf books</option>
              {myBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            What won it *
          </label>
          <input
            type="text"
            value={workTitle}
            onChange={(e) => setWorkTitle(e.target.value)}
            placeholder="Title of the book, story, or manuscript"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date won *</label>
          <input
            type="date"
            value={awardDate}
            onChange={(e) => setAwardDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Link (optional)
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
          >
            {isPending ? (award ? "Saving..." : "Adding...") : award ? "Save changes" : "Add award"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
