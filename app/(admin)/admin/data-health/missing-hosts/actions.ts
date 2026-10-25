"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { UNHOSTED_LIST_LIMIT } from "@/lib/missing-hosts";

const PAGE = "/admin/data-health/missing-hosts";

export type UnhostedPrickle = { id: string; title: string | null; startTime: string; endTime: string; typeName: string };

/** Flip whether a prickle type needs a host. */
export async function setRequiresHost(typeId: string, requiresHost: boolean): Promise<{ error?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase.from("prickle_types").update({ requires_host: requiresHost }).eq("id", typeId);
  if (error) {
    console.error("Error updating prickle type:", error);
    return { error: error.message };
  }
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
  return {};
}

/** The newest calendar prickles of a type that have no host (the detail view of one row). */
export async function getUnhostedPrickles(typeId: string): Promise<{ error: string } | { prickles: UnhostedPrickle[] }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  try {
    const found = await createRepos(auth.supabase).prickles.hostlessCalendarOfType(typeId, UNHOSTED_LIST_LIMIT);
    return { prickles: found.map((p) => ({ id: p.id, title: p.title, startTime: p.startTime, endTime: p.endTime, typeName: p.type?.name ?? "Prickle" })) };
  } catch (err) {
    console.error("Error loading unhosted prickles:", err);
    return { error: (err as Error).message };
  }
}
