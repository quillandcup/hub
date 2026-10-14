"use server";

import { requireAdminAction } from "@/lib/admin-auth";

/** Flip whether a prickle type needs a host. */
export async function setRequiresHost(typeId: string, requiresHost: boolean): Promise<{ error?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase.from("prickle_types").update({ requires_host: requiresHost }).eq("id", typeId);
  if (error) {
    console.error("Error updating prickle type:", error);
    return { error: error.message };
  }
  return {};
}

/** Set (or clear, with null) a prickle type's default host. */
export async function setDefaultHost(typeId: string, memberId: string | null): Promise<{ error?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase.from("prickle_types").update({ default_host_id: memberId }).eq("id", typeId);
  if (error) {
    console.error("Error setting default host:", error);
    return { error: error.message };
  }
  return {};
}
