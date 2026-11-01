"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
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
  const repos = createRepos(supabase);

  if (!available) {
    try {
      await repos.mentorship.withdraw(identity.memberId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    const member = await repos.members.byId(identity.memberId);
    if (!member) return { error: "No member record" };
    const eligibility = getVolunteerEligibility(
      { firstJoinedAt: member.firstJoinedAt, mostRecentJoinedAt: member.mostRecentJoinedAt },
      new Date()
    );
    if (!eligibility.eligible) return { error: volunteerEligibilityMessage(eligibility) };

    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) return { error: "Keep the note under 300 characters." };
    try {
      await repos.mentorship.volunteer(identity.memberId, trimmed);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
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
  let saved: boolean;
  try {
    saved = await createRepos(supabase).mentorship.setNote(mentorshipId, note);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!saved) return { error: "That isn't one of your matches." };

  revalidatePath("/big-sisters");
  revalidatePath("/dashboard");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setBigSisterAvailability(...args: Parameters<typeof setBigSisterAvailabilityImpl>): ReturnType<typeof setBigSisterAvailabilityImpl> {
  return withAction("big_sister_availability_set", () => setBigSisterAvailabilityImpl(...args));
}
