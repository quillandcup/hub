"use client";

import { useState } from "react";
import type { BookCard } from "./live-books";

/**
 * The grid of the Hedgie Bookshelf block: every card is in the page (so a search engine and a reader without scripts get all of
 * them), the ones past the first screenful are hidden until "Show more books" is pressed. Without scripts the `noscript` style
 * shows them all. The only client code of the block.
 */

function Cover({ book }: { book: BookCard }) {
  return book.cover ? (
    // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
    <img src={book.cover} alt={`Cover of ${book.title}`} loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <div role="img" aria-label={`${book.title}: no cover yet`} className="flex h-full w-full items-center justify-center bg-gradient-to-br from-plum-200 to-plum-400 p-3 text-center font-display text-lg font-semibold text-plum-900">
      {book.title}
    </div>
  );
}

function Card({ book, hidden }: { book: BookCard; hidden: boolean }) {
  const cover = (
    <div className="aspect-[2/3] overflow-hidden rounded-lg shadow-md">
      <Cover book={book} />
    </div>
  );
  return (
    <li hidden={hidden} data-book-more={hidden ? "" : undefined} className="flex min-w-0 flex-col gap-2">
      {book.href ? (
        <a href={book.href} rel="noopener noreferrer nofollow ugc" aria-label={`${book.title}${book.author ? `, by ${book.author}` : ""}: where to get it`}>
          {cover}
        </a>
      ) : (
        cover
      )}
      <div className="space-y-0.5">
        <p className="font-display text-base font-semibold leading-tight">{book.title}</p>
        {book.author && <p className="text-sm">by {book.author}</p>}
      </div>
    </li>
  );
}

export default function BookGrid({ books, firstShown, step }: { books: BookCard[]; firstShown: number; step: number }) {
  const [shown, setShown] = useState(firstShown);
  const more = books.length - shown;
  return (
    <>
      <noscript>
        <style>{`[data-book-more][hidden]{display:flex}`}</style>
      </noscript>
      <ul className="grid grid-cols-2 gap-5 text-left @pair:grid-cols-3 @cards:grid-cols-4" aria-label="Books by our members">
        {books.map((book, i) => (
          <Card key={`${i}-${book.title}`} book={book} hidden={i >= shown} />
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-6 text-center">
          <button
            type="button"
            data-track="bookshelf-block-show-more"
            onClick={() => setShown((n) => n + step)}
            className="rounded-full border-2 border-current px-5 py-2 text-sm font-semibold hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Show more books
          </button>
        </p>
      )}
    </>
  );
}
