"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { invalidateLiveLandingData } from "@/lib/landing/live-cache";
import { isVisibility, type Visibility } from "@/lib/writing-visibility";
import { validateBookInput } from "@/lib/bookValidation";
import { cleanGenres } from "@/lib/book-genres";
import { cleanEditions, type BookEdition, type BookEditionInput, type BookFormat } from "@/lib/book-editions";
import { createRepos } from "@/lib/data/repos";
import { releaseReplacedCover, resolveBookCover } from "@/lib/book-cover-assets";
import { celebrateNewBook } from "@/lib/slack";
import { getPenNameOptions, resolvePenName, type PenNameOptions } from "@/lib/book-pen-name";

import { actionOutcome, withAction } from "@/lib/analytics/server";
export type { BookFormat };

export interface BookInput {
  title: string;
  description?: string;
  coverUrl: string;
  publishedDate: string;
  /** One edition per format (print, ebook), each with its own link and price; at least one. */
  editions: BookEditionInput[];
  /** Genre tags, in the member's order (at most MAX_GENRES, see src/lib/book-genres.ts). */
  genres?: string[];
  /** Name the book is published under: the member's display name or one of their aliases; blank = display name. */
  penName?: string | null;
}

export interface MyBookRow {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string;
  publishedDate: string;
  /** One per format, print first. */
  editions: BookEditionInput[];
  genres: string[];
  /** Null when the book follows the member's display name. */
  penName: string | null;
  /** The Projects entry this book was published from, or null for a standalone/legacy book. */
  projectId: string | null;
  /** The media library image behind the cover, with its size (for the Amazon download); null for an older cover. */
  coverAsset: { id: string; width: number; height: number } | null;
  /** Who can see the book: only the member, other members, or the web. */
  visibility: Visibility;
  /** The name the book carries on the web (its pen name, else the member's display name), or null when it has none: then the web shows no author name. */
  webAuthor: string | null;
}

type IdentityContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<IdentityContext> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { supabase, effectiveIdentity };
}


/** The acting member's own books, for the "My Books" panel on the Projects page. */
export async function getMyBooks(): Promise<MyBookRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const repos = createRepos(supabase);
  const [books, member] = await Promise.all([repos.books.mine(effectiveIdentity.memberId), repos.members.byId(effectiveIdentity.memberId)]);
  const displayName = member?.displayName?.trim() || null;

  return books.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    publishedDate: row.published_date,
    editions: row.editions.map((e) => ({ format: e.format, purchaseUrl: e.purchase_url, price: e.price })),
    genres: row.genres,
    penName: row.pen_name,
    projectId: row.project_id,
    coverAsset: row.cover_asset,
    visibility: row.visibility,
    webAuthor: row.pen_name?.trim() || displayName,
  }));
}

async function addBookImpl(input: BookInput): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const validationError = validateBookInput(input);
  if (validationError) return { error: validationError };

  const pen = await resolvePenName(supabase, effectiveIdentity.memberId, input.penName);
  if ("error" in pen) return pen;

  const cover = await resolveBookCover(createRepos(supabase).media, effectiveIdentity.memberId, input.coverUrl);
  if ("error" in cover) return cover;

  const editions = cleanEditions(input.editions);
  try {
    await createRepos(supabase).books.add({
      member_id: effectiveIdentity.memberId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      cover_url: cover.url,
      cover_asset_id: cover.assetId,
      published_date: input.publishedDate,
      editions,
      genres: cleanGenres(input.genres),
      pen_name: pen.penName,
    });
  } catch (error) {
    return { error: (error as Error).message };
  }

  // Fire-and-forget: a Slack outage must never block the book from being added.
  celebrateNewBook({
    title: input.title.trim(),
    memberId: effectiveIdentity.memberId,
    memberName: effectiveIdentity.memberDisplayName ?? effectiveIdentity.memberName,
    purchaseUrl: editions[0].purchase_url,
  }).catch((err) => console.error("New book Slack notification failed:", err));

  // The public Bookshelf block reads the books through a one-minute cache: drop it so a change (a book taken off the web) shows at once.
  invalidateLiveLandingData();
  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

async function updateBookImpl(
  bookId: string,
  input: BookInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const validationError = validateBookInput(input);
  if (validationError) return { error: validationError };

  const { media, books } = createRepos(supabase);
  // A pen name the book already has stays as it is (staff set some from the old Bookshelf list, `pnpm books:authors`, and they are not
  // all among the member's own names), so editing something else about the book never fails on it; a different one is checked as ever.
  const keeps = input.penName?.trim() && input.penName.trim() === (await books.mine(effectiveIdentity.memberId)).find((b) => b.id === bookId)?.pen_name;
  const pen = keeps ? { penName: input.penName!.trim() } : await resolvePenName(supabase, effectiveIdentity.memberId, input.penName);
  if ("error" in pen) return pen;

  const cover = await resolveBookCover(media, effectiveIdentity.memberId, input.coverUrl);
  if ("error" in cover) return cover;

  let previousCoverAssetId: string | null;
  let found: boolean;
  try {
    previousCoverAssetId = await books.coverAssetIdOf(bookId);
    // RLS scopes this to the acting member's own rows (or an admin's, during sudo) -- a
    // zero-row result means the id didn't belong to them, not a silent no-op.
    found = await books.update(bookId, {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      cover_url: cover.url,
      cover_asset_id: cover.assetId,
      published_date: input.publishedDate,
      editions: cleanEditions(input.editions),
      genres: cleanGenres(input.genres),
      pen_name: pen.penName,
    });
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (!found) return { error: "Book not found" };

  await releaseReplacedCover(media, effectiveIdentity.memberId, previousCoverAssetId, cover.assetId);

  // The public Bookshelf block reads the books through a one-minute cache: drop it so a change (a book taken off the web) shows at once.
  invalidateLiveLandingData();
  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

async function deleteBookImpl(bookId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  // Soft delete: the row stays, with the member's own words, until they ask us to remove it (/privacy).
  // RLS scopes this to the acting member's own rows (or an admin's, during sudo).
  try {
    if (!(await createRepos(supabase).books.remove(bookId))) return { error: "Book not found" };
  } catch (error) {
    return { error: (error as Error).message };
  }

  // The public Bookshelf block reads the books through a one-minute cache: drop it so a change (a book taken off the web) shows at once.
  invalidateLiveLandingData();
  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

/**
 * A member sets who can see one of their books: only them, other members, or the web (the public Hedgie Bookshelf). Saved the
 * moment they click the lock, house or globe. Never in sudo (staff acting as the member can look, not change what the
 * member shows the world), and only the member's own live book. "No change" writes nothing. The change is an audit entry as
 * the member (the table's trigger, which is also the Activity Log line) and never carries the title or description in the sentence.
 */
async function setBookVisibilityImpl(bookId: string, level: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;
  if (effectiveIdentity.isSudo) return { error: "Only the member can change who sees their book." };
  if (!bookId) return { error: "Book not found" };
  if (!isVisibility(level)) return { error: "That choice is not available." };

  try {
    const books = createRepos(supabase).books;
    // Only the acting member's own books are listed here, so a book of someone else is "not found", never a silent write.
    const book = (await books.mine(effectiveIdentity.memberId)).find((b) => b.id === bookId);
    if (!book) return { error: "Book not found" };
    if (book.visibility === level) return { success: true };
    if (!(await books.update(bookId, { visibility: level }))) return { error: "Book not found" };
  } catch (error) {
    console.error("books.setVisibility failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }

  // The public Bookshelf block reads the books through a one-minute cache: drop it so a change (a book taken off the web) shows at once.
  invalidateLiveLandingData();
  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

/** The names the acting member can publish a book under, for the form's "Published as" picker. */
export async function getMyPenNameOptions(): Promise<PenNameOptions | null> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return null;
  return getPenNameOptions(ctx.supabase, ctx.effectiveIdentity.memberId);
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function addBook(...args: Parameters<typeof addBookImpl>): ReturnType<typeof addBookImpl> {
  return withAction("book_added", () => addBookImpl(...args));
}

export async function updateBook(...args: Parameters<typeof updateBookImpl>): ReturnType<typeof updateBookImpl> {
  return withAction("book_edited", () => updateBookImpl(...args));
}

// Whether it worked, and the level chosen (a fixed word, never anything the member wrote).
export async function setBookVisibility(...args: Parameters<typeof setBookVisibilityImpl>): ReturnType<typeof setBookVisibilityImpl> {
  return withAction("book_visibility_set", () => setBookVisibilityImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: isVisibility(args[1]) ? args[1] : undefined,
  }));
}

export async function deleteBook(...args: Parameters<typeof deleteBookImpl>): ReturnType<typeof deleteBookImpl> {
  return withAction("book_deleted", () => deleteBookImpl(...args));
}
