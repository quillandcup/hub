"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { safeUrl } from "@/lib/url";
import { validateAwardInput } from "@/lib/awardValidation";
import { notifyStaffNewAward } from "@/lib/slack";

export interface AwardInput {
  awardName: string;
  category?: string;
  workTitle: string;
  bookId?: string | null;
  projectId?: string | null;
  awardDate: string;
  url?: string;
  notes?: string;
}

export interface MyAwardRow {
  id: string;
  awardName: string;
  category: string | null;
  workTitle: string;
  bookId: string | null;
  projectId: string | null;
  awardDate: string;
  url: string | null;
  notes: string | null;
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

/** The acting member's own awards, for the "My Awards" panel on the Projects page. */
export async function getMyAwards(): Promise<MyAwardRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const { data } = await supabase
    .from("member_awards")
    .select("id, award_name, category, work_title, book_id, project_id, award_date, url, notes")
    .eq("member_id", effectiveIdentity.memberId)
    .order("award_date", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    awardName: row.award_name,
    category: row.category,
    workTitle: row.work_title,
    bookId: row.book_id,
    projectId: row.project_id,
    awardDate: row.award_date,
    url: row.url,
    notes: row.notes,
  }));
}

export async function addAward(input: AwardInput): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const validationError = validateAwardInput(input);
  if (validationError) return { error: validationError };

  const { error } = await supabase.from("member_awards").insert({
    member_id: effectiveIdentity.memberId,
    award_name: input.awardName.trim(),
    category: input.category?.trim() || null,
    work_title: input.workTitle.trim(),
    book_id: input.bookId || null,
    project_id: input.projectId || null,
    award_date: input.awardDate,
    url: safeUrl(input.url),
    notes: input.notes?.trim() || null,
  });

  if (error) return { error: error.message };

  // Fire-and-forget: a Slack outage must never block the win from being recorded.
  notifyStaffNewAward({
    awardName: input.awardName.trim(),
    workTitle: input.workTitle.trim(),
    memberId: effectiveIdentity.memberId,
    memberName: effectiveIdentity.memberName,
    url: safeUrl(input.url),
  }).catch((err) => console.error("New award Slack notification failed:", err));

  revalidatePath("/projects");
  revalidatePath("/awards");
  return { success: true };
}

export async function updateAward(
  awardId: string,
  input: AwardInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase } = ctx;

  const validationError = validateAwardInput(input);
  if (validationError) return { error: validationError };

  // RLS scopes this to the acting member's own rows (or an admin's, during sudo) -- a zero-row
  // result means the id didn't belong to them, not a silent no-op.
  const { data, error } = await supabase
    .from("member_awards")
    .update({
      award_name: input.awardName.trim(),
      category: input.category?.trim() || null,
      work_title: input.workTitle.trim(),
      book_id: input.bookId || null,
      project_id: input.projectId || null,
      award_date: input.awardDate,
      url: safeUrl(input.url),
      notes: input.notes?.trim() || null,
    })
    .eq("id", awardId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Award not found" };

  revalidatePath("/projects");
  revalidatePath("/awards");
  return { success: true };
}

export async function deleteAward(awardId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase.from("member_awards").delete().eq("id", awardId).select("id").single();

  if (error || !data) return { error: error?.message ?? "Award not found" };

  revalidatePath("/projects");
  revalidatePath("/awards");
  return { success: true };
}
