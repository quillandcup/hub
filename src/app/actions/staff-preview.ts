"use server";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { staffHome } from "@/lib/permissions";
import { parsePreviewRole, STAFF_PREVIEW_COOKIE } from "@/lib/staff-preview";

/**
 * Start looking at the admin area as a lower staff role (src/lib/staff-preview.ts). Only a real admin may:
 * checked against `user_profiles`, not requireActionPermission(), which refuses while a preview is on.
 */
export async function startRolePreview(role: string): Promise<string> {
  // Throws when refused, like startSudo. Returns the page to open instead of redirecting: the admin layout (banner, sidebar,
  // user menu) stays mounted through a redirect inside the staff area, so the caller loads that page in full.
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
  return staffHome(previewRole);
}

/** Back to the admin's own view. Deleting your own preview cookie needs no check. */
export async function stopRolePreview(): Promise<string> {
  (await cookies()).delete(STAFF_PREVIEW_COOKIE);
  return "/admin";
}
