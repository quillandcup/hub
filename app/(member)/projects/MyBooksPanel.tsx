"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BookFormModal from "@/components/books/BookFormModal";
import { deleteBook, type MyBookRow } from "@/app/(member)/bookshelf/actions";

interface MyBooksPanelProps {
  /** Books not linked to any tracked project -- a published project's book shows on that
   * project's card/detail page instead (see WritingProjectRow.book), so it isn't duplicated here. */
  initialBooks: MyBookRow[];
}

function formatDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatPrice(price: number | null): string | null {
  return price == null ? null : `$${price.toFixed(2)}`;
}

/** Manages books not tied to a tracked project (past books added before this feature, or added
 * standalone) -- relocated here from the old Bookshelf "My Books" panel, which is now a
 * read-only community gallery. Publishing a project (see ProjectsClient) is the fast path for a
 * new book; this stays as the manual fallback. */
export default function MyBooksPanel({ initialBooks }: MyBooksPanelProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editingBook, setEditingBook] = useState<MyBookRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleSaved() {
    router.refresh();
  }

  async function handleDelete(book: MyBookRow) {
    if (!confirm(`Remove "${book.title}" from the Bookshelf?`)) return;
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
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          My Books
        </h2>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          + Add a book
        </button>
      </div>

      {initialBooks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No standalone books yet -- publishing a project above adds one automatically.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {initialBooks.map((book) => (
            <li key={book.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{book.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(book.publishedDate)} · <span className="capitalize">{book.format}</span>
                  {formatPrice(book.price) && ` · ${formatPrice(book.price)}`}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingBook(book)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Edit
                </button>
                <button
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
