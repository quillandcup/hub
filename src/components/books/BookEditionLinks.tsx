import { BOOK_FORMAT_LABELS, formatPrice, sortEditions, type BookFormat } from "@/lib/book-editions";
import { safeUrl } from "@/lib/url";

interface BookEditionLinksProps {
  editions: { format: BookFormat; purchaseUrl: string; price?: number | null }[];
  /** `data-track` name for each link. */
  track: string;
  className?: string;
}

/** Where to buy a book: one link per edition, with its price ("Print $14.00 · Ebook $5.00"). A link that isn't http(s) is shown as plain text. */
export default function BookEditionLinks({ editions, track, className }: BookEditionLinksProps) {
  return (
    <span className={className}>
      {sortEditions(editions).map((edition, index) => {
        const label = [BOOK_FORMAT_LABELS[edition.format], formatPrice(edition.price)].filter(Boolean).join(" ");
        const href = safeUrl(edition.purchaseUrl);
        return (
          <span key={edition.format}>
            {index > 0 && " · "}
            {href ? (
              <a href={href} data-track={track} target="_blank" rel="noopener noreferrer" className="hover:underline text-plum-600 dark:text-plum-400">
                {label}
              </a>
            ) : (
              label
            )}
          </span>
        );
      })}
    </span>
  );
}
