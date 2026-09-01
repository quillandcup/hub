// The book cover spec this site has always used (see the "Celebrating Your New
// Published Hedgie Book!" Google Form it replaces): PNG or JPEG, exactly
// 145x215px. Shared between the client-side picker (fast feedback) and the
// upload API route (authoritative check on the actual file bytes).

export const BOOK_COVER_WIDTH = 145;
export const BOOK_COVER_HEIGHT = 215;
export const BOOK_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const BOOK_COVER_ALLOWED_TYPES = ["image/png", "image/jpeg"] as const;

export function describeBookCoverRequirements(): string {
  return `PNG or JPEG, exactly ${BOOK_COVER_WIDTH}x${BOOK_COVER_HEIGHT}px, under ${
    BOOK_COVER_MAX_BYTES / (1024 * 1024)
  }MB`;
}

export function validateBookCoverFile(file: { type: string; size: number }): string | null {
  if (!(BOOK_COVER_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return "Cover must be a PNG or JPEG image";
  }
  if (file.size > BOOK_COVER_MAX_BYTES) {
    return `Cover must be under ${BOOK_COVER_MAX_BYTES / (1024 * 1024)}MB`;
  }
  return null;
}

export function validateBookCoverDimensions(width: number, height: number): string | null {
  if (width !== BOOK_COVER_WIDTH || height !== BOOK_COVER_HEIGHT) {
    return `Cover must be exactly ${BOOK_COVER_WIDTH}x${BOOK_COVER_HEIGHT}px (yours is ${width}x${height})`;
  }
  return null;
}
