"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { checkinFromRow, validateCheckin, writeCheckin, type CheckinInput } from "@/lib/prickle-checkins";

export type SaveCheckinResult = { success: true } | { error: string };

/**
 * The effective member's check-in for a prickle, or null if they haven't made one. Works in sudo:
 * admins can read every check-in (migration 20261003000000), so an admin browsing as a member
 * sees that member's answers.
 */
export async function getMyCheckin(prickleId: string): Promise<CheckinInput | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("prickle_checkins")
    .select("feelings_before, need, session_rating, feelings_after")
    .eq("member_id", identity.memberId)
    .eq("prickle_id", prickleId)
    .is("deleted_at", null)
    .maybeSingle();
  return data ? checkinFromRow(data) : null;
}

/**
 * The check-in for a prickle as the Log Progress modal needs it: the saved answers (if any) and
 * whether the member may change them -- not in sudo, where saveCheckin refuses.
 */
export async function getCheckinForLogging(
  prickleId: string
): Promise<{ checkin: CheckinInput | null; canEdit: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { checkin: null, canEdit: false };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { checkin: null, canEdit: false };
  return { checkin: await getMyCheckin(prickleId), canEdit: !identity.isSudo };
}

/**
 * Save (or, when every answer is cleared, soft-delete) the signed-in member's check-in for a prickle.
 * Refused in sudo: a check-in is the member's own feelings, so nobody records them on someone's
 * behalf (RLS also keeps writes owner-only, resolving the member from the session).
 */
export async function saveCheckin(prickleId: string, input: CheckinInput): Promise<SaveCheckinResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Check-ins aren't available in sudo mode." };

  if (typeof prickleId !== "string" || !prickleId) return { error: "Invalid prickle" };
  const validationError = validateCheckin(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  const error = await writeCheckin(supabase, identity.memberId, prickleId, input);
  if (error) {
    console.error("[prickle-checkins] Saving check-in failed", { member: identity.memberId, prickleId, error });
    return { error: "Couldn't save your check-in — please try again." };
  }

  revalidatePath(`/prickles/${prickleId}`);
  return { success: true };
}
