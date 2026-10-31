"use client";

import { useMemo, useState } from "react";
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
  genres: string[];
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

/** Every genre on the shelf with how many books carry it, most common first. Spellings that differ only in case count as one. */
function genreCounts(shelf: ShelfBook[]): { genre: string; count: number }[] {
  const counts = new Map<string, { genre: string; count: number }>();
  for (const book of shelf) {
    for (const genre of book.genres) {
      const entry = counts.get(genre.toLowerCase());
      if (entry) entry.count += 1;
      else counts.set(genre.toLowerCase(), { genre, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

const chipClass = (active: boolean) =>
  `rounded-full px-2.5 py-0.5 text-sm ${
    active
      ? "bg-plum-600 text-white"
      : "bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 hover:bg-plum-100 dark:hover:bg-plum-800"
  }`;

export default function BookshelfClient({ shelf }: BookshelfClientProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const genres = useMemo(() => genreCounts(shelf), [shelf]);
  const shown = selected ? shelf.filter((book) => book.genres.some((g) => g.toLowerCase() === selected)) : shelf;

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">🐚 Hedgie Book Shelf</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Books published by members of the community.{" "}
          <Link href="/projects" data-track="bookshelf-publish-project" className="text-plum-600 hover:text-plum-700 dark:text-plum-400">
            Publish a project
          </Link>{" "}
          to add yours — it also earns you the Published Author badge.
        </p>
      </div>

      <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
        The Shelf ({shown.length})
      </h2>
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter by genre">
          <button
            type="button"
            data-track="bookshelf-filter-genre"
            aria-pressed={selected === null}
            onClick={() => setSelected(null)}
            className={chipClass(selected === null)}
          >
            All
          </button>
          {genres.map(({ genre, count }) => (
            <button
              key={genre.toLowerCase()}
              type="button"
              data-track="bookshelf-filter-genre"
              aria-pressed={selected === genre.toLowerCase()}
              onClick={() => setSelected(selected === genre.toLowerCase() ? null : genre.toLowerCase())}
              className={chipClass(selected === genre.toLowerCase())}
            >
              {genre} ({count})
            </button>
          ))}
        </div>
      )}
      {shelf.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No books yet — be the first!</p>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 @pair:grid-cols-2 gap-4">
          {shown.map((book) => (
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
                  <a href={book.purchaseUrl} data-track="bookshelf-open-book" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {book.title}
                  </a>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  by{" "}
                  <Link href={`/members/${book.memberId}`} data-track="bookshelf-open-author" className="hover:underline">
                    {book.memberName}
                  </Link>{" "}
                  · {formatDate(book.publishedDate)}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span className="capitalize">{book.format}</span>
                  {book.genres.length > 0 && <span>· {book.genres.join(", ")}</span>}
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
        </div>
      )}
    </div>
  );
}
