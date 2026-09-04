"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import {
  updateProjectDetails,
  setStartingBalances,
  updateProjectCover,
  type WritingProjectRow,
} from "@/app/(member)/projects/actions";
import { MEASURE_LABELS, WRITING_MEASURES, type WritingMeasure } from "@/lib/writing-projects";
import {
  describeBookCoverRequirements,
  validateBookCoverDimensions,
  validateBookCoverFile,
} from "@/lib/bookCover";

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

/** Reads the pixel dimensions of an image file in the browser, without uploading it. */
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image file"));
    };
    img.src = objectUrl;
  });
}

export default function ProjectDetailsModal({ isOpen, onClose, onSaved, project }: ProjectDetailsModalProps) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [coverUrl, setCoverUrl] = useState(project.coverUrl ?? "");
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [startingBalances, setStartingBalancesState] = useState<Record<string, string>>(
    Object.fromEntries(STARTING_BALANCE_MEASURES.map((m) => [m, project.startingBalances[m]?.toString() ?? ""]))
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed attempt
    if (!file) return;

    setCoverError(null);

    const fileError = validateBookCoverFile(file);
    if (fileError) {
      setCoverError(fileError);
      return;
    }

    let dimensions: { width: number; height: number };
    try {
      dimensions = await readImageDimensions(file);
    } catch {
      setCoverError("Couldn't read that image file");
      return;
    }
    const dimensionError = validateBookCoverDimensions(dimensions.width, dimensions.height);
    if (dimensionError) {
      setCoverError(dimensionError);
      return;
    }

    setIsUploadingCover(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/bookshelf/cover", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setCoverError(json.error ?? "Upload failed, try again");
        return;
      }
      const result = await updateProjectCover(project.id, json.url);
      if ("error" in result) {
        setCoverError(result.error);
        return;
      }
      setCoverUrl(json.url);
    } catch {
      setCoverError("Upload failed, try again");
    } finally {
      setIsUploadingCover(false);
    }
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
            Description <span className="text-slate-400 font-normal">(optional)</span>
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
            Cover image <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="flex items-start gap-3">
            {coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded file, not optimizable by next/image
              <img
                src={coverUrl}
                alt="Cover preview"
                className="w-16 h-24 object-cover rounded border border-slate-200 dark:border-slate-700 flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleCoverFileChange}
                disabled={isUploadingCover}
                className="block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isUploadingCover ? "Uploading..." : describeBookCoverRequirements()}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Uses the same spec your published book cover will need, so you won&apos;t have to re-upload at publish time.
              </p>
              {coverError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{coverError}</p>}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Starting balance <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            How much you already had before tracking this project here.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STARTING_BALANCE_MEASURES.map((measure) => (
              <div key={measure}>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                  {MEASURE_LABELS[measure]}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || isUploadingCover}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
