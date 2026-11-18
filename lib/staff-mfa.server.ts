import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { clock } from "@/lib/clock";
import { hasVerifiedTotp, isStaffMfaEnforced, staffMfaState, type StaffMfaState } from "@/lib/staff-mfa";

/** What the signed-in session has done about a second step: its level, and whether the account has a verified TOTP factor. */
export type MfaStatus = { aal2: boolean; hasFactor: boolean };

/**
 * Reads the session's level from the verified token claims (local, no network) and, only when it isn't aal2, the user's
 * factors from Supabase Auth (a network call, so a factor removed in the dashboard counts at once rather than when the
 * token refreshes). A staff session that already passed its challenge costs nothing extra.
 * A failed read counts as "has a factor": it sends the visitor to the code screen rather than waving them through.
 */
export async function readMfaStatus(supabase: Pick<SupabaseClient, "auth">): Promise<MfaStatus> {
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.aal === "aal2") return { aal2: true, hasFactor: true };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { aal2: false, hasFactor: true };
  return { aal2: false, hasFactor: hasVerifiedTotp(data.user.factors) };
}

/** The gate state for a staff request, from a client in hand (API routes). */
export async function staffMfaStateFor(supabase: Pick<SupabaseClient, "auth">): Promise<StaffMfaState> {
  const status = await readMfaStatus(supabase);
  return staffMfaState({ aal: status.aal2 ? "aal2" : "aal1", hasFactor: status.hasFactor, enforced: isStaffMfaEnforced(clock.now()) });
}

/** Same, for pages and actions: one read per render (React `cache()`), shared by the layout, the page and the banner. */
export const getStaffMfaState = cache(async (): Promise<StaffMfaState> => staffMfaStateFor(await createClient()));
