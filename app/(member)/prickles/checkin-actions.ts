"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { isEmptyCheckin, validateCheckin, type CheckinInput, type Feeling, type Need } from "@/lib/prickle-checkins";

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
    .maybeSingle();
  if (!data) return null;

  return {
    feelingsBefore: (data.feelings_before ?? []) as Feeling[],
    need: (data.need ?? null) as Need | null,
    sessionRating: data.session_rating ?? null,
    feelingsAfter: (data.feelings_after ?? []) as Feeling[],
  };
}

/**
 * Save (or, when every answer is cleared, delete) the signed-in member's check-in for a prickle.
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

  if (isEmptyCheckin(input)) {
    const { error } = await supabase
      .from("prickle_checkins")
      .delete()
      .eq("member_id", identity.memberId)
      .eq("prickle_id", prickleId);
    if (error) {
      console.error("[prickle-checkins] Deleting check-in failed", { member: identity.memberId, prickleId, error });
      return { error: "Couldn't save your check-in — please try again." };
    }
  } else {
    const { error } = await supabase.from("prickle_checkins").upsert(
      {
        member_id: identity.memberId,
        prickle_id: prickleId,
        feelings_before: input.feelingsBefore,
        need: input.need,
        session_rating: input.sessionRating,
        feelings_after: input.feelingsAfter,
      },
      { onConflict: "member_id,prickle_id" }
    );
    if (error) {
      console.error("[prickle-checkins] Saving check-in failed", { member: identity.memberId, prickleId, error });
      return { error: "Couldn't save your check-in — please try again." };
    }
  }

  revalidatePath(`/prickles/${prickleId}`);
  return { success: true };
}
