"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { previewMemberRemoval, removeMemberOnRequest, type RemovalPreview } from "@/lib/member-removal";

/** What removing this member would do: a dry run, nothing changes. Staff only. */
export async function previewRemoval(memberId: string): Promise<{ error: string } | { preview: RemovalPreview }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  try {
    return { preview: await previewMemberRemoval(createServiceRoleClient(), memberId) };
  } catch (error) {
    console.error("[member-removal] preview failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't load what would be removed." };
  }
}

export type RemovalActionResult = { error: string } | { success: true; leftovers: string[] };

async function removeMemberImpl(adminUserId: string, memberId: string, keepPublic: boolean, confirmName: string): Promise<RemovalActionResult> {
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  const db = createServiceRoleClient();
  const repos = createRepos(db);
  const member = await repos.members.byId(memberId);
  if (!member) return { error: "Member not found." };
  if (member.email.endsWith("@removed.invalid")) return { error: "This member was already removed." };
  if (confirmName.trim() !== member.name) return { error: "The name you typed doesn't match this member's name." };
  // Never remove the person asking, and never someone with admin access: take that away first.
  if (member.userId && member.userId === adminUserId) return { error: "You can't remove your own record." };
  if (member.userId && (await repos.profiles.isAdmin(member.userId))) return { error: "This member is an admin. Change their role first." };

  const result = await removeMemberOnRequest(db, memberId, keepPublic);
  if (!result.ok) {
    console.error("[member-removal] failed:", result.error);
    return { error: "The removal failed and nothing was changed." };
  }
  if (result.leftovers.length > 0) console.error("[member-removal] finished with leftovers:", result.leftovers.length);
  revalidatePath("/admin/members");
  return { success: true, leftovers: result.leftovers };
}

/**
 * Removes a member on their request, irreversibly (see lib/member-removal.ts). Staff only, after the dry run, with the
 * member's name typed to confirm. `keepPublic` is the member's answer about their books and awards on the bookshelf.
 */
export async function removeMember(memberId: string, keepPublic: boolean, confirmName: string): Promise<RemovalActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("member_removed", () => removeMemberImpl(auth.user.id, memberId, keepPublic, confirmName), (r) => ({ ok: "success" in r }));
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
