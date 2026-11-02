// The spec file for scripts/import-storefront-books.ts, checked before anything is read or written, so a missing field
// is named up front instead of surfacing as a database error half way through (or, for `format`, silently defaulting).

export interface BookSpec {
  memberName: string;
  title: string;
  coverUrl: string;
  purchaseUrl: string;
  publishedDate: string;
  price: number;
  format: "print" | "ebook";
}

export type ParsedSpec = { ok: true; books: BookSpec[] } | { ok: false; errors: string[] };

const TEXT_FIELDS = ["memberName", "title", "coverUrl", "purchaseUrl", "publishedDate"] as const;

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Every problem in the spec, by position, so one run lists them all. `format` is required: print is never assumed. */
export function parseBookSpec(input: unknown): ParsedSpec {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: ["The spec must be a non-empty JSON array of books"] };
  const errors: string[] = [];
  const books: BookSpec[] = [];
  input.forEach((raw, index) => {
    const at = `Book ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const book = raw as Record<string, unknown>;
    const before = errors.length;
    for (const field of TEXT_FIELDS) {
      if (typeof book[field] !== "string" || book[field].trim() === "") errors.push(`${at}: ${field} is missing`);
    }
    for (const field of ["coverUrl", "purchaseUrl"] as const) {
      if (typeof book[field] === "string" && !/^https:\/\//.test(book[field])) errors.push(`${at}: ${field} must be an https link`);
    }
    if (typeof book.publishedDate === "string" && book.publishedDate !== "" && !isDate(book.publishedDate)) errors.push(`${at}: publishedDate must be YYYY-MM-DD`);
    if (typeof book.price !== "number" || !Number.isFinite(book.price) || book.price < 0) errors.push(`${at}: price must be a number`);
    if (book.format !== "print" && book.format !== "ebook") errors.push(`${at}: format must be "print" or "ebook"`);
    if (errors.length === before) books.push(book as unknown as BookSpec);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, books };
}
