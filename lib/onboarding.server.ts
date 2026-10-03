import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { buildOnboardingState, type OnboardingRecord, type OnboardingState } from "@/lib/onboarding";
import { PICKER_HISTORY_MONTHS } from "@/lib/prickle-picker";
import { getMonthStart } from "@/lib/prickle-schedules";

/**
 * The member's "Getting started" tour state, from their own data plus member_onboarding.
 * One round of parallel reads; memoized per render so the layout and any page share it.
 * `userId` is the signed-in auth user, whose account age decides whether the tour starts by itself.
 */
export const getOnboardingState = cache(async (userId: string, memberId: string): Promise<OnboardingState> => {
  const supabase = await createClient();

  const now = new Date();
  const hostHistoryStart = new Date(now);
  hostHistoryStart.setMonth(hostHistoryStart.getMonth() - PICKER_HISTORY_MONTHS);
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);

  const [
    record,
    profile,
    member,
    override,
    askMeAbout,
    latestProject,
    goals,
    commitments,
    calendarItems,
    hostedEver,
    hostedRecently,
    latestSchedule,
    hostVibes,
  ] = await Promise.all([
    supabase
      .from("member_onboarding")
      .select("marked_steps, dismissed_at, completed_at")
      .eq("member_id", memberId)
      .maybeSingle(),
    supabase.from("user_profiles").select("created_at").eq("id", userId).maybeSingle(),
    supabase.from("members").select("bio").eq("id", memberId).maybeSingle(),
    // A just-saved bio sits here until member processing copies it to members.bio.
    supabase.from("member_profile_overrides").select("bio").eq("member_id", memberId).maybeSingle(),
    supabase.from("member_ask_me_about").select("topics").eq("member_id", memberId).maybeSingle(),
    supabase
      .from("writing_projects")
      .select("id")
      .eq("member_id", memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("writing_goals").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    supabase
      .from("prickle_commitments")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId)
      .eq("status", "active"),
    supabase.from("calendar_feed_items").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    supabase.from("prickles").select("id", { count: "exact", head: true }).eq("host", memberId),
    supabase
      .from("prickles")
      .select("id", { count: "exact", head: true })
      .eq("host", memberId)
      .gte("start_time", hostHistoryStart.toISOString()),
    supabase
      .from("prickle_schedules")
      .select("month")
      .eq("host_id", memberId)
      .is("deleted_at", null)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("prickle_host_vibes").select("type_id", { count: "exact", head: true }).eq("host_id", memberId),
  ]);
  const latestScheduleMonth = (latestSchedule.data?.month as string | undefined) ?? null;

  const topics = (askMeAbout.data?.topics as string[] | null) ?? [];
  const createdAt = profile.data?.created_at ? new Date(profile.data.created_at) : null;

  return buildOnboardingState(
    {
      hasProfile: !!(member.data?.bio?.trim() || override.data?.bio?.trim()) || topics.length > 0,
      latestProjectId: latestProject.data?.id ?? null,
      hasGoal: (goals.count ?? 0) > 0,
      hasPricklePlan: (commitments.count ?? 0) > 0 || (calendarItems.count ?? 0) > 0,
      isHost: (hostedEver.count ?? 0) > 0 || latestScheduleMonth !== null,
      // Month strings are YYYY-MM-DD, so they compare as dates.
      hasHostingSchedule: latestScheduleMonth !== null && latestScheduleMonth >= currentMonth,
      hostedRecently: (hostedRecently.count ?? 0) > 0,
      hasHostVibe: (hostVibes.count ?? 0) > 0,
    },
    (record.data as OnboardingRecord | null) ?? null,
    createdAt,
    now
  );
});
