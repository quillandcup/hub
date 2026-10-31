"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import {
  updateProjectDetails,
  setStartingBalances,
  updateProjectCover,
  deleteProject,
  type WritingProjectRow,
} from "@/app/(member)/projects/actions";
import { MEASURE_LABELS, WRITING_MEASURES, type WritingMeasure } from "@/lib/writing-projects";
import BookCoverDetails, { type CoverAsset } from "@/components/books/BookCoverDetails";
import MediaPicker from "@/components/media/MediaPicker";
import { bookCoverUrlFor, coverAssetIdOf } from "@/lib/bookCover";

interface ProjectDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  project: WritingProjectRow;
}

/** Measures a starting balance can be set against -- 'prickles' is always computed live from
 * attendance, never manually logged or carried over (see setStartingBalances). */
const STARTING_BALANCE_MEASURES = WRITING_MEASURES.filter((m) => m !== "prickles") as Exclude<
  WritingMeasure,
  "prickles"
>[];

export default function ProjectDetailsModal({ isOpen, onClose, onSaved, project }: ProjectDetailsModalProps) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [coverUrl, setCoverUrl] = useState(project.coverUrl ?? "");
  const [coverAsset, setCoverAsset] = useState<CoverAsset | null>(null);
  const [startingBalances, setStartingBalancesState] = useState<Record<string, string>>(
    Object.fromEntries(STARTING_BALANCE_MEASURES.map((m) => [m, project.startingBalances[m]?.toString() ?? ""]))
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const alsoRemains = project.book ? " The book on your Book Shelf stays." : "";
    if (!confirm(`Delete "${project.title}" with its goals and progress? You can't get it back.${alsoRemains}`)) return;
    setError(null);
    setIsPending(true);
    const result = await deleteProject(project.id);
    if ("error" in result) {
      setIsPending(false);
      setError(result.error);
      return;
    }
    window.location.href = "/projects";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Give your project a title");
      return;
    }

    setIsPending(true);

    const detailsResult = await updateProjectDetails(project.id, { title, description });
    if ("error" in detailsResult) {
      setIsPending(false);
      setError(detailsResult.error);
      return;
    }

    const balancesPayload = Object.fromEntries(
      STARTING_BALANCE_MEASURES.map((m) => [m, startingBalances[m].trim() ? Number(startingBalances[m]) : 0])
    ) as Partial<Record<Exclude<WritingMeasure, "prickles">, number>>;
    const balancesResult = await setStartingBalances(project.id, balancesPayload);
    setIsPending(false);

    if ("error" in balancesResult) {
      setError(balancesResult.error);
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Project Details" maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Description <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Cover image <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
          </label>
          <MediaPicker
            own
            shape="cover"
            noun="cover"
            alt="Cover preview"
            surface="book_cover"
            preview="book_cover_shelf"
            removable={false}
            value={coverAssetIdOf(coverUrl)}
            onChange={async (id, picked) => {
              if (!id || !picked) return;
              const url = bookCoverUrlFor(id);
              const result = await updateProjectCover(project.id, url);
              if ("error" in result) return result.error;
              setCoverUrl(url);
              setCoverAsset(picked);
            }}
          >
            <BookCoverDetails
              url={coverUrl}
              asset={coverAsset}
              hint="It's the cover your published book will use, so you won't have to upload it again at publish time."
            />
          </MediaPicker>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Starting balance <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
            How much you already had before tracking this project here.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STARTING_BALANCE_MEASURES.map((measure) => (
              <div key={measure}>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">
                  {MEASURE_LABELS[measure]}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={startingBalances[measure]}
                  onChange={(e) =>
                    setStartingBalancesState((prev) => ({ ...prev, [measure]: e.target.value }))
                  }
                  placeholder="0"
                  className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button data-track="project-details-cancel"
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button data-track="project-details-save-changes"
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <button data-track="project-delete"
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
          >
            Delete project
          </button>
        </div>
      </form>
    </Modal>
  );
}
