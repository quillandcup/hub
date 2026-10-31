"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import {
  addBook,
  getMyPenNameOptions,
  updateBook,
  type BookFormat,
  type BookInput,
  type MyBookRow,
} from "@/app/(member)/bookshelf/actions";
import { publishProject } from "@/app/(member)/projects/actions";
import type { PenNameOptions } from "@/lib/book-pen-name";
import BookCoverDetails, { type CoverAsset } from "@/components/books/BookCoverDetails";
import MediaPicker from "@/components/media/MediaPicker";
import TagInput from "@/components/TagInput";
import { MAX_GENRE_LENGTH, MAX_GENRES } from "@/lib/book-genres";
import { bookCoverUrlFor, coverAssetIdOf } from "@/lib/bookCover";

interface BookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Present for edit, absent for add/publish. */
  book?: MyBookRow;
  /** Present when publishing a project (no `book`) -- prefills the title and routes the submit
   * through publishProject instead of addBook. Absent for a plain standalone add/edit. */
  projectId?: string;
  projectTitle?: string;
  /** Prefills description/cover from the project's own (pre-publish) values when publishing, so a
   * member who already filled these in via "Edit details" doesn't have to redo them. Ignored when
   * `book` is present (editing an existing Bookshelf entry always starts from the book's values). */
  initialDescription?: string;
  initialCoverUrl?: string;
}

export default function BookFormModal({
  isOpen,
  onClose,
  onSaved,
  book,
  projectId,
  projectTitle,
  initialDescription,
  initialCoverUrl,
}: BookFormModalProps) {
  const [title, setTitle] = useState(book?.title ?? projectTitle ?? "");
  const [description, setDescription] = useState(book?.description ?? initialDescription ?? "");
  const [coverUrl, setCoverUrl] = useState(book?.coverUrl ?? initialCoverUrl ?? "");
  const [coverAsset, setCoverAsset] = useState<CoverAsset | null>(book?.coverAsset ?? null);
  const [purchaseUrl, setPurchaseUrl] = useState(book?.purchaseUrl ?? "");
  const [publishedDate, setPublishedDate] = useState(book?.publishedDate ?? "");
  const [price, setPrice] = useState(book?.price != null ? String(book.price) : "");
  const [genres, setGenres] = useState<string[]>(book?.genres ?? []);
  const [format, setFormat] = useState<BookFormat>(book?.format ?? "print");
  const [penName, setPenName] = useState(book?.penName ?? "");
  const [penNameOptions, setPenNameOptions] = useState<PenNameOptions | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getMyPenNameOptions().then((options) => {
      if (!cancelled) setPenNameOptions(options);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // A name the book already carries stays selectable even if the alias was switched off since.
  const penNameChoices = penNameOptions
    ? [...penNameOptions.others, ...(penName && !penNameOptions.others.includes(penName) ? [penName] : [])]
    : [];

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
      genres,
      format,
      penName,
    };

    setIsPending(true);
    const result = book
      ? await updateBook(book.id, input)
      : projectId
        ? await publishProject(projectId, input)
        : await addBook(input);
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  const modalTitle = book ? "Edit Book" : projectId ? `Publish "${projectTitle}"` : "Add a Book";
  const submitLabel = book ? "Save changes" : projectId ? "Publish" : "Add book";
  const pendingLabel = book ? "Saving..." : projectId ? "Publishing..." : "Adding...";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!projectId && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-300 space-y-1">
            <p>
              To be included, this book must have been substantially written as part of your Quill &amp; Cup
              experience. Although this is hard to provide hard-and-fast rules for, here are some
              definitions-by-example:
            </p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>If you joined with an idea and 10,000 words that eventually grew to 100,000 words...</li>
              <li>If you had a completed draft before joining and revised through two more drafts...</li>
              <li>If you had a published manuscript but rewrote within BFFship before re-publishing...</li>
            </ul>
            <p>
              Ultimately, if you feel like this book would not have been possible without Q&amp;C, we want to
              highlight it!
            </p>
          </div>
        )}

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

        {penNameChoices.length > 0 && penNameOptions && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Published as</label>
            <select data-track="book-form-pen-name" aria-label="Published as"
              value={penName}
              onChange={(e) => setPenName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              <option value="">{penNameOptions.defaultName}</option>
              {penNameChoices.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Format</label>
            <select data-track="book-form-print-ebook"
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
          <label htmlFor="book-genres" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Genre
          </label>
          <TagInput
            id="book-genres"
            tags={genres}
            onChange={setGenres}
            placeholder="e.g. romance, fantasy, cozy mystery"
            maxTags={MAX_GENRES}
            maxTagLength={MAX_GENRE_LENGTH}
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
          <MediaPicker
            own
            shape="cover"
            noun="cover"
            alt="Cover preview"
            surface="book_cover"
            preview="book_cover_shelf"
            removable={false}
            value={coverAssetIdOf(coverUrl)}
            onChange={(id, picked) => {
              if (!id || !picked) return;
              setCoverUrl(bookCoverUrlFor(id));
              setCoverAsset(picked);
            }}
          >
            <BookCoverDetails url={coverUrl} asset={coverAsset} />
          </MediaPicker>
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
          <button data-track="book-form-cancel"
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            Cancel
          </button>
          <button data-track="book-form-save"
            type="submit"
            disabled={isPending || !coverUrl}
            className="px-4 py-2 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg text-sm font-medium"
          >
            {isPending ? pendingLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
