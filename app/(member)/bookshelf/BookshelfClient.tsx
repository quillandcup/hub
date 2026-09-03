"use client";

import Link from "next/link";
import type { BookFormat } from "./actions";

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

export default function BookshelfClient({ shelf }: BookshelfClientProps) {
  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">🐚 Hedgie Bookshelf</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Books published by members of the community.{" "}
          <Link href="/projects" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            Publish a project
          </Link>{" "}
          to add yours — it also earns you the Published Author badge.
        </p>
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
    </div>
  );
}
