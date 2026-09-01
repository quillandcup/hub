"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BookFormModal from "@/components/books/BookFormModal";
import { deleteBook, type BookFormat, type MyBookRow } from "./actions";

export interface ShelfBook {
  id: string;
  memberId: string;
  memberName: string;
  title: string;
  description: string | null;
  coverUrl: string;
  purchaseUrl: string;
  publishedDate: string;
  price: number | null;
  genre: string | null;
  format: BookFormat;
}

interface BookshelfClientProps {
  shelf: ShelfBook[];
  initialMyBooks: MyBookRow[];
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

export default function BookshelfClient({ shelf, initialMyBooks }: BookshelfClientProps) {
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
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">🐚 Hedgie Bookshelf</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Books published by members of the community. Add yours below — it also earns you the
          Published Author badge.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-8">
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

        {initialMyBooks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You haven&apos;t added any books yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {initialMyBooks.map((book) => (
              <li key={book.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {book.title}
                  </p>
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
      </div>

      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        The Shelf ({shelf.length})
      </h2>
      {shelf.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No books yet — be the first!</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {shelf.map((book) => (
            <div
              key={book.id}
              className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex gap-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size (145x215) uploads served from Supabase Storage, not optimizable by next/image */}
              <img
                src={book.coverUrl}
                alt={`Cover of ${book.title}`}
                className="w-16 h-24 object-cover rounded flex-shrink-0 bg-slate-100 dark:bg-slate-800"
              />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <a href={book.purchaseUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {book.title}
                  </a>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  by{" "}
                  <Link href={`/members/${book.memberId}`} className="hover:underline">
                    {book.memberName}
                  </Link>{" "}
                  · {formatDate(book.publishedDate)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span className="capitalize">{book.format}</span>
                  {book.genre && <span>· {book.genre}</span>}
                  {formatPrice(book.price) && <span>· {formatPrice(book.price)}</span>}
                </p>
                {book.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 line-clamp-3">
                    {book.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <BookFormModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSaved={handleSaved} />
      {editingBook && (
        <BookFormModal
          isOpen={true}
          onClose={() => setEditingBook(null)}
          onSaved={handleSaved}
          book={editingBook}
        />
      )}
    </div>
  );
}
