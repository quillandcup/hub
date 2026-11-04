import type { Json } from "@/lib/data/database.types";
import { safeUrl } from "@/lib/url";

/**
 * A book is one card with up to one edition per format (`member_books.editions`): each edition has
 * its own link and price. Mirrors the CHECK public.valid_book_editions, so the form can reject bad
 * input before the database does.
 */

export const BOOK_FORMATS = ["print", "ebook"] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

export const BOOK_FORMAT_LABELS: Record<BookFormat, string> = { print: "Print", ebook: "Ebook" };

/** An edition as stored. */
export interface BookEdition {
  format: BookFormat;
  purchase_url: string;
  price: number | null;
}

/** An edition as the form and the actions carry it. */
export interface BookEditionInput {
  format: BookFormat;
  purchaseUrl: string;
  price?: number | null;
}

const isFormat = (value: unknown): value is BookFormat => (BOOK_FORMATS as readonly unknown[]).includes(value);

/** The editions a row carries, print before ebook. */
export function rowEditions(stored: Json): BookEdition[] {
  const parsed: BookEdition[] = [];
  for (const item of Array.isArray(stored) ? stored : []) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const { format, purchase_url, price } = item;
    if (!isFormat(format) || typeof purchase_url !== "string") continue;
    parsed.push({ format, purchase_url, price: typeof price === "number" ? price : null });
  }
  return sortEditions(parsed);
}

export function sortEditions<T extends { format: BookFormat }>(editions: readonly T[]): T[] {
  return [...editions].sort((a, b) => BOOK_FORMATS.indexOf(a.format) - BOOK_FORMATS.indexOf(b.format));
}

/** What the form sent, as stored: safe links, a price or null. Call after {@link editionsError} passes. */
export function cleanEditions(editions: readonly BookEditionInput[]): BookEdition[] {
  return editions.map((e) => ({ format: e.format, purchase_url: safeUrl(e.purchaseUrl.trim())!, price: e.price ?? null }));
}

/** The editions as written to `member_books.editions`, print first. */
export function storedEditions(editions: readonly BookEdition[]): Json {
  return sortEditions(editions).map((e) => ({ format: e.format, purchase_url: e.purchase_url, price: e.price }));
}

/** Why a set of editions can't be saved, or null. */
export function editionsError(editions: readonly BookEditionInput[] | null | undefined): string | null {
  if (!editions || editions.length === 0) return "Add at least one way to buy it, print or ebook";
  const seen = new Set<string>();
  for (const edition of editions) {
    if (!isFormat(edition.format)) return "Choose print or ebook for each edition";
    const label = BOOK_FORMAT_LABELS[edition.format];
    if (seen.has(edition.format)) return `Only one ${label.toLowerCase()} edition per book`;
    seen.add(edition.format);
    if (!edition.purchaseUrl?.trim()) return `Where to buy the ${label.toLowerCase()} edition is required`;
    if (!safeUrl(edition.purchaseUrl.trim())) return `Enter a valid link (starting with https://) for where to buy the ${label.toLowerCase()} edition`;
    if (edition.price != null && !(Number.isFinite(edition.price) && edition.price >= 0)) return `The ${label.toLowerCase()} price must be zero or more`;
  }
  return null;
}

export function formatPrice(price: number | null | undefined): string | null {
  return price == null ? null : `$${price.toFixed(2)}`;
}

/** "Print $14.00 · Ebook $5.00": what a book is sold as, for a line of small text. */
export function editionsSummary(editions: readonly { format: BookFormat; price?: number | null }[]): string {
  return sortEditions(editions)
    .map((e) => [BOOK_FORMAT_LABELS[e.format], formatPrice(e.price)].filter(Boolean).join(" "))
    .join(" · ");
}
