"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { safeUrl } from "@/lib/url";
import { validateBookInput } from "@/lib/bookValidation";
import { notifyStaffNewBook } from "@/lib/slack";
import { getPenNameOptions, resolvePenName, type PenNameOptions } from "@/lib/book-pen-name";

import { withAction } from "@/lib/analytics/server";
export type BookFormat = "print" | "ebook";

export interface BookInput {
  title: string;
  description?: string;
  coverUrl: string;
  purchaseUrl: string;
  publishedDate: string;
  price?: number | null;
  genre?: string;
  format: BookFormat;
  /** Name the book is published under: the member's display name or one of their aliases; blank = display name. */
  penName?: string | null;
}

export interface MyBookRow {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string;
  purchaseUrl: string;
  publishedDate: string;
  price: number | null;
  genre: string | null;
  format: BookFormat;
  /** Null when the book follows the member's display name. */
  penName: string | null;
  /** The Projects entry this book was published from, or null for a standalone/legacy book. */
  projectId: string | null;
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

  const { data } = await supabase
    .from("member_books")
    .select("id, title, description, cover_url, purchase_url, published_date, price, genre, format, project_id, pen_name")
    .eq("member_id", effectiveIdentity.memberId)
    .order("published_date", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    purchaseUrl: row.purchase_url,
    publishedDate: row.published_date,
    price: row.price,
    genre: row.genre,
    format: row.format as BookFormat, // a check constraint limits the column to print and ebook
    penName: row.pen_name,
    projectId: row.project_id,
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

  const { error } = await supabase.from("member_books").insert({
    member_id: effectiveIdentity.memberId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    cover_url: safeUrl(input.coverUrl)!, // validateBookInput rejected anything safeUrl would null
    purchase_url: safeUrl(input.purchaseUrl)!,
    published_date: input.publishedDate,
    price: input.price ?? null,
    genre: input.genre?.trim() || null,
    format: input.format,
    pen_name: pen.penName,
  });

  if (error) return { error: error.message };

  // Fire-and-forget: a Slack outage must never block the book from being added.
  notifyStaffNewBook({
    title: input.title.trim(),
    memberId: effectiveIdentity.memberId,
    memberName: effectiveIdentity.memberName,
    purchaseUrl: safeUrl(input.purchaseUrl),
  }).catch((err) => console.error("New book Slack notification failed:", err));

  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

export async function updateBook(
  bookId: string,
  input: BookInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const validationError = validateBookInput(input);
  if (validationError) return { error: validationError };

  const pen = await resolvePenName(supabase, effectiveIdentity.memberId, input.penName);
  if ("error" in pen) return pen;

  // RLS scopes this to the acting member's own rows (or an admin's, during sudo) -- a
  // zero-row result means the id didn't belong to them, not a silent no-op.
  const { data, error } = await supabase
    .from("member_books")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      cover_url: safeUrl(input.coverUrl)!, // validateBookInput rejected anything safeUrl would null
      purchase_url: safeUrl(input.purchaseUrl)!,
      published_date: input.publishedDate,
      price: input.price ?? null,
      genre: input.genre?.trim() || null,
      format: input.format,
      pen_name: pen.penName,
    })
    .eq("id", bookId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Book not found" };

  revalidatePath("/bookshelf");
  revalidatePath("/projects", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

export async function deleteBook(bookId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data, error } = await supabase.from("member_books").delete().eq("id", bookId).select("id").single();

  if (error || !data) return { error: error?.message ?? "Book not found" };

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

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function addBook(...args: Parameters<typeof addBookImpl>): ReturnType<typeof addBookImpl> {
  return withAction("book_added", () => addBookImpl(...args));
}
