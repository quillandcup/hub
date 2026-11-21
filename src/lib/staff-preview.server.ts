import { cookies } from "next/headers";
import { parsePreviewRole, STAFF_PREVIEW_COOKIE, type PreviewableRole } from "@/lib/staff-preview";

/** The role this request previews (only meaningful for a real admin), or null. Null outside a request too. */
export async function getStaffPreviewRole(): Promise<PreviewableRole | null> {
  try {
    return parsePreviewRole((await cookies()).get(STAFF_PREVIEW_COOKIE)?.value);
  } catch {
    return null;
  }
}
