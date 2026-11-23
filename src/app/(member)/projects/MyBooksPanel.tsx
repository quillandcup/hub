"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BookFormModal from "@/components/books/BookFormModal";
import { editionsSummary } from "@/lib/book-editions";
import VisibilityControl from "@/components/writing/VisibilityControl";
import { describeBookLevel, NO_WEB_AUTHOR_LINE } from "@/lib/book-visibility";
import type { Visibility } from "@/lib/writing-visibility";
import { deleteBook, setBookVisibility, type MyBookRow } from "@/app/(member)/bookshelf/actions";

interface MyBooksPanelProps {
  initialBooks: MyBookRow[];
  /** Titles of the member's projects by id, to link a published project's book back to it. */
  projectTitles: Record<string, string>;
}

function formatDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}


/** Manages all of the member's books -- both those published from a tracked project and standalone
 * ones (past books added before projects existed, or added by hand). Relocated here from the old
 * Bookshelf "My Books" panel, which is now a read-only community gallery. Publishing a project
 * (see ProjectsClient) is the fast path for a new book; "Add a book" stays as the manual fallback. */
export default function MyBooksPanel({ initialBooks, projectTitles }: MyBooksPanelProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editingBook, setEditingBook] = useState<MyBookRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, Visibility>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSaved() {
    router.refresh();
  }

  /** One click on the control: shown at once, saved, and put back with the reason when it could not be saved. */
  async function changeLevel(book: MyBookRow, next: Visibility) {
    setSavingId(book.id);
    setErrors((e) => ({ ...e, [book.id]: "" }));
    setLevels((l) => ({ ...l, [book.id]: next }));
    const result = await setBookVisibility(book.id, next);
    setSavingId(null);
    if ("error" in result) {
      setLevels((l) => ({ ...l, [book.id]: book.visibility }));
      setErrors((e) => ({ ...e, [book.id]: result.error }));
      return;
    }
    router.refresh();
  }

  async function handleDelete(book: MyBookRow) {
    const projectTitle = book.projectId ? projectTitles[book.projectId] : undefined;
    const message = projectTitle
      ? `Remove "${book.title}" from the Book Shelf? "${projectTitle}" will no longer be marked as published.`
      : `Remove "${book.title}" from the Book Shelf?`;
    if (!confirm(message)) return;
    setDeletingId(book.id);
    const result = await deleteBook(book.id);
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
        <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">My Books</h2>
        <button data-track="project-books-add-a-book"
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-plum-600 hover:bg-plum-700 text-white rounded-lg text-sm font-medium"
        >
          + Add a book
        </button>
      </div>

      {initialBooks.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No books yet -- publishing a project adds one automatically, or add one by hand.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {initialBooks.map((book) => (
            <li key={book.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{book.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {formatDate(book.publishedDate)} · {editionsSummary(book.editions)}
                  {book.projectId && projectTitles[book.projectId] && (
                    <>
                      {" · From "}
                      <Link data-track="project-books-open-project"
                        href={`/projects/${book.projectId}`}
                        className="text-plum-600 dark:text-plum-400 hover:underline"
                      >
                        {projectTitles[book.projectId]}
                      </Link>
                    </>
                  )}
                </p>
                {(levels[book.id] ?? book.visibility) === "public" && !book.webAuthor && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-testid="book-no-web-author">{NO_WEB_AUTHOR_LINE}</p>
                )}
                {errors[book.id] && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[book.id]}</p>}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <VisibilityControl
                  visibility={levels[book.id] ?? book.visibility}
                  onChange={(next) => changeLevel(book, next)}
                  disabled={savingId === book.id}
                  noun="book"
                  describe={describeBookLevel}
                  withText
                  className="text-xs text-slate-700 dark:text-slate-300"
                />
                <button data-track="project-books-edit"
                  type="button"
                  onClick={() => setEditingBook(book)}
                  className="text-xs text-plum-600 dark:text-plum-400 hover:underline"
                >
                  Edit
                </button>
                <button data-track="project-books-remove"
                  type="button"
                  onClick={() => handleDelete(book)}
                  disabled={deletingId === book.id}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  {deletingId === book.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BookFormModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSaved={handleSaved} />
      {editingBook && (
        <BookFormModal isOpen={true} onClose={() => setEditingBook(null)} onSaved={handleSaved} book={editingBook} />
      )}
    </div>
  );
}
