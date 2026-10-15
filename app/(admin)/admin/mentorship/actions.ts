"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { MENTORSHIP_DAYS, parseMatchInput, type MentorshipStatus } from "@/lib/mentorship";
import { getArrivals } from "@/lib/arrivals";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendMatchIntroductions } from "@/lib/mentorship-intro";

const BASE_PATH = "/admin/mentorship";

type ActionResult = { success: true } | { error: string };

// The unique index on (new_member_id, started_on) WHERE status = 'matched': one big sister per arrival.
const ONE_BIG_SISTER = "That member already has a big sister for this arrival. Mark the old match as reassigned first.";

const NOT_AN_ARRIVAL =
  "No recent sign-up found for that member. A big sister is for someone whose membership began in the last " +
  `${MENTORSHIP_DAYS} days and who wasn't already a member the day before (a rejoin counts). It shows up once Kajabi and Stripe have imported the sign-up.`;

/**
 * Matches a new member with a big sister. Staff choose the two people; nothing else is typed. When
 * their membership began, whether it was a trial (and when that ends) and how they arrived come from
 * the data (lib/arrivals.ts), so a start date can't be wrong or forgotten.
 */
export async function createMentorship(input: {
  mentorMemberId: string | null;
  newMemberId: string | null;
}): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const parsed = parseMatchInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const { mentorMemberId, newMemberId } = parsed.value;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - MENTORSHIP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const arrival = (await getArrivals(auth.supabase, since, today)).find((a) => a.memberId === newMemberId);
  if (!arrival) return { error: NOT_AN_ARRIVAL };

  const { error } = await auth.supabase.from("mentorships").insert({
    mentor_member_id: mentorMemberId,
    new_member_id: newMemberId,
    started_on: arrival.arrivedOn,
    trial_ends_on: arrival.trialEndsOn,
    kind: arrival.kind,
  });
  if (error) return { error: error.code === "23505" ? ONE_BIG_SISTER : error.message };

  await sendMatchIntroductions(
    createServiceRoleClient(),
    { mentorMemberId, newMemberId, startedOn: arrival.arrivedOn },
    today
  );

  revalidatePath(BASE_PATH, "layout");
  return { success: true };
}

export async function updateMentorship(
  id: string,
  changes: {
    outcomeNote?: string | null;
    status?: MentorshipStatus;
  }
): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const update: Record<string, unknown> = {};
  if (changes.outcomeNote !== undefined) update.outcome_note = changes.outcomeNote?.trim() || null;
  if (changes.status !== undefined) {
    if (changes.status !== "matched" && changes.status !== "reassigned") return { error: "Unknown status." };
    update.status = changes.status;
  }
  if (Object.keys(update).length === 0) return { success: true };

  const { error } = await auth.supabase.from("mentorships").update(update).eq("id", id);
  if (error) return { error: error.code === "23505" ? ONE_BIG_SISTER : error.message };

  revalidatePath(BASE_PATH, "layout");
  return { success: true };
}

export async function deleteMentorship(id: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase.from("mentorships").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(BASE_PATH, "layout");
  return { success: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Adds a member to the volunteer pool for staff (a member can also do it themselves on /big-sisters). */
export async function addVolunteer(memberId: string | null, note?: string | null): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!memberId || !UUID.test(memberId)) return { error: "Choose a member." };
  const trimmed = note?.trim() || null;
  if (trimmed && trimmed.length > 300) return { error: "Keep the note under 300 characters." };

  const { error } = await auth.supabase
    .from("big_sister_volunteers")
    .upsert({ member_id: memberId, note: trimmed, deleted_at: null }, { onConflict: "member_id" });
  if (error) return { error: error.message };

  revalidatePath(BASE_PATH, "layout");
  return { success: true };
}

/** Takes a member off the volunteer pool (kept as history; they can volunteer again). */
export async function removeVolunteer(memberId: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase
    .from("big_sister_volunteers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .is("deleted_at", null);
  if (error) return { error: error.message };

  revalidatePath(BASE_PATH, "layout");
  return { success: true };
}
