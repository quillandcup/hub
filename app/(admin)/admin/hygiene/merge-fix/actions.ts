"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function dismissGroup(groupKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("dismissed_duplicate_groups")
    .insert({ user_id: user.id, group_key: groupKey });

  if (error && error.code !== "23505") return { error: error.message }; // ignore duplicate
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}

export async function undismissGroup(groupKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("dismissed_duplicate_groups")
    .delete()
    .eq("user_id", user.id)
    .eq("group_key", groupKey);

  if (error) return { error: error.message };
  revalidatePath("/admin/hygiene/merge-fix");
  return { success: true };
}
