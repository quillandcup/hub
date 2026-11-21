"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import { createRepos } from "@/lib/data/repos";

export async function dismissGroup(groupKey: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  try {
    await createRepos(supabase).adminWork.dismissGroup(groupKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}

export async function undismissGroup(groupKey: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  try {
    await createRepos(supabase).adminWork.restoreGroup(groupKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}
