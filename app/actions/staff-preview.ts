"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { COMMUNITY_MANAGER_HOME } from "@/lib/staff-access";
import { parsePreviewRole, STAFF_PREVIEW_COOKIE } from "@/lib/staff-preview";

/**
 * Start looking at the admin area as a lower staff role (lib/staff-preview.ts). Only a real admin may:
 * checked against `user_profiles`, not requireAdminAction(), which refuses while a preview is on.
 */
export async function startRolePreview(role: string): Promise<void> {
  // Throws, like startSudo: it is a form action, so there is no result to show.
  const user = await getCurrentUser();
  if (!user || !(await createRepos(await createClient()).profiles.isAdmin(user.id))) throw new Error("Not authorized");
  const previewRole = parsePreviewRole(role);
  if (!previewRole) throw new Error("Unknown role");

  (await cookies()).set(STAFF_PREVIEW_COOKIE, previewRole, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  redirect(COMMUNITY_MANAGER_HOME);
}

/** Back to the admin's own view. Deleting your own preview cookie needs no check. */
export async function stopRolePreview() {
  (await cookies()).delete(STAFF_PREVIEW_COOKIE);
  redirect("/admin");
}
