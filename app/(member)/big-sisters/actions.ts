"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getVolunteerEligibility, volunteerEligibilityMessage } from "@/lib/big-sister-volunteers";

import { withAction } from "@/lib/analytics/server";
type Result = { success: true } | { error: string };

/** Volunteer to be a Big Sister (with an optional note for staff), or withdraw. The member's own
 * row only, and read-only in sudo. */
async function setBigSisterAvailabilityImpl(available: boolean, note?: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Viewing as a member is read-only." };

  const supabase = await createClient();

  if (!available) {
    const { error } = await supabase
      .from("big_sister_volunteers")
      .update({ deleted_at: new Date().toISOString() })
      .eq("member_id", identity.memberId)
      .is("deleted_at", null);
    if (error) return { error: error.message };
  } else {
    const { data: member } = await supabase
      .from("members")
      .select("first_joined_at, most_recent_joined_at")
      .eq("id", identity.memberId)
      .maybeSingle();
    if (!member) return { error: "No member record" };
    const eligibility = getVolunteerEligibility(
      { firstJoinedAt: member.first_joined_at, mostRecentJoinedAt: member.most_recent_joined_at },
      new Date()
    );
    if (!eligibility.eligible) return { error: volunteerEligibilityMessage(eligibility) };

    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) return { error: "Keep the note under 300 characters." };
    const { error } = await supabase
      .from("big_sister_volunteers")
      .upsert({ member_id: identity.memberId, note: trimmed, deleted_at: null }, { onConflict: "member_id" });
    if (error) return { error: error.message };
  }

  revalidatePath("/big-sisters");
  return { success: true };
}

/**
 * A big sister records why a trial didn't continue, on their own match. Goes through
 * set_mentorship_note, which only lets the match's big sister (or an admin) write the note, and
 * only the note. Read-only in sudo.
 */
export async function saveReasonNote(mentorshipId: string, note: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Viewing as a member is read-only." };
  if (note.trim().length > 1000) return { error: "Keep it under 1000 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_mentorship_note", { p_mentorship_id: mentorshipId, p_note: note });
  if (error) return { error: error.message };
  if (data !== true) return { error: "That isn't one of your matches." };

  revalidatePath("/big-sisters");
  revalidatePath("/dashboard");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setBigSisterAvailability(...args: Parameters<typeof setBigSisterAvailabilityImpl>): ReturnType<typeof setBigSisterAvailabilityImpl> {
  return withAction("big_sister_availability_set", () => setBigSisterAvailabilityImpl(...args));
}
