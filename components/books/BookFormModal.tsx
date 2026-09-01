"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import {
  addBook,
  updateBook,
  type BookFormat,
  type BookInput,
  type MyBookRow,
} from "@/app/(member)/bookshelf/actions";
import {
  describeBookCoverRequirements,
  validateBookCoverDimensions,
  validateBookCoverFile,
} from "@/lib/bookCover";

interface BookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Present for edit, absent for add. */
  book?: MyBookRow;
}

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

export default function BookFormModal({ isOpen, onClose, onSaved, book }: BookFormModalProps) {
  const [title, setTitle] = useState(book?.title ?? "");
  const [description, setDescription] = useState(book?.description ?? "");
  const [coverUrl, setCoverUrl] = useState(book?.coverUrl ?? "");
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [purchaseUrl, setPurchaseUrl] = useState(book?.purchaseUrl ?? "");
  const [publishedDate, setPublishedDate] = useState(book?.publishedDate ?? "");
  const [price, setPrice] = useState(book?.price != null ? String(book.price) : "");
  const [genre, setGenre] = useState(book?.genre ?? "");
  const [format, setFormat] = useState<BookFormat>(book?.format ?? "print");
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

    const input: BookInput = {
      title,
      description,
      coverUrl,
      purchaseUrl,
      publishedDate,
      price: price.trim() === "" ? null : Number(price),
      genre,
      format,
    };

    setIsPending(true);
    const result = book ? await updateBook(book.id, input) : await addBook(input);
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={book ? "Edit Book" : "Add a Book"} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title *</label>
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
            Publication date *
          </label>
          <input
            type="date"
            value={publishedDate}
            onChange={(e) => setPublishedDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as BookFormat)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              <option value="print">Print</option>
              <option value="ebook">Ebook</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Price (optional)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="17.99"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Genre (optional)
          </label>
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Romance, Fantasy, Mystery..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Description (optional)
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
            Cover image *
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
              {coverError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{coverError}</p>}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Where to buy it *
          </label>
          <input
            type="url"
            value={purchaseUrl}
            onChange={(e) => setPurchaseUrl(e.target.value)}
            placeholder="https://..."
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
            disabled={isPending || isUploadingCover || !coverUrl}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
          >
            {isPending ? "Saving..." : book ? "Save changes" : "Add book"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
