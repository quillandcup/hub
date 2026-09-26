"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";

export async function dismissGroup(groupKey: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  const { error } = await supabase
    .from("dismissed_duplicate_groups")
    .insert({ group_key: groupKey });

  if (error && error.code !== "23505") return { error: error.message }; // ignore duplicate
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}

export async function undismissGroup(groupKey: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  const { error } = await supabase
    .from("dismissed_duplicate_groups")
    .delete()
    .eq("group_key", groupKey);

  if (error) return { error: error.message };
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}
