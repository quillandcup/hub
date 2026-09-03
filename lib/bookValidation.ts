import { safeUrl } from "@/lib/url";
import type { BookInput } from "@/app/(member)/bookshelf/actions";

/**
 * Shared field validation for a member_books row -- used by both bookshelf/actions.ts
 * (addBook/updateBook) and projects/actions.ts (publishProject). Lives outside any "use server"
 * module because a "use server" file may only export async functions at the top level.
 */
export function validateBookInput(input: BookInput): string | null {
  if (!input.title?.trim()) return "Title is required";
  if (!input.publishedDate) return "Publication date is required";
  if (!input.coverUrl?.trim()) return "Cover image is required";
  if (!safeUrl(input.coverUrl)) return "Cover image failed to upload correctly — try again";
  if (!input.purchaseUrl?.trim()) return "Where to buy it is required";
  if (!safeUrl(input.purchaseUrl)) return "Enter a valid link (starting with https://) for where to buy it";
  return null;
}
