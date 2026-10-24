import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  buildOnboardingState,
  type OnboardingRecord,
  type OnboardingSignals,
  type OnboardingState,
  unseenStepIds,
} from "@/lib/onboarding";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { SLACK_WORKSPACE_URL } from "@/lib/config";
import { isNewcomer } from "@/lib/newcomer";
import { createRepos } from "@/lib/data/repos";
import { loadAttendedMemberIds, loadIntroChannelId, loadIntroducedMemberIds } from "@/lib/newcomer-signals";
import { loadCalendarFeedPrickleIds } from "@/lib/calendar-feed";
import { PICKER_HISTORY_MONTHS } from "@/lib/prickle-picker";
import { getMonthStart } from "@/lib/prickle-schedules";
import { getMyMentorships } from "@/lib/my-mentorship";
import { membersWithFeature } from "@/lib/features.server";
import { getSlackConnectionStatus, isSlackConnectConfigured } from "@/lib/slack-connect";

/** Placeholder signals for a tour that isn't showing: nothing reads the steps then. */
const NO_SIGNALS: OnboardingSignals = {
  hasHubProfile: false,
  latestProjectId: null,
  hasGoal: false,
  hasPricklePlan: false,
  isHost: false,
  hasHostingSchedule: false,
  hostedRecently: false,
  hasHostVibe: false,
  isNewcomer: false,
  introUrl: null,
  hasIntroduced: false,
  hasAttendedPrickle: false,
  hasUpcomingPrickle: false,
  hasCalendarSynced: false,
  hasBirthday: false,
  bigSisterName: null,
};

/** The newcomer steps' signals (lib/newcomer.ts); all false/null for someone past their first 90 days. */
async function loadNewcomerSignals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  now: Date
): Promise<Pick<OnboardingSignals, "isNewcomer" | "introUrl" | "hasIntroduced" | "hasAttendedPrickle" | "hasUpcomingPrickle">> {
  const none = { isNewcomer: false, introUrl: null, hasIntroduced: false, hasAttendedPrickle: false, hasUpcomingPrickle: false };
  const { data: member } = await supabase.from("members").select("first_joined_at").eq("id", memberId).maybeSingle();
  if (!isNewcomer(member?.first_joined_at as string | null | undefined, now)) return none;

  const [introduced, attended, channelId, upcoming] = await Promise.all([
    loadIntroducedMemberIds(supabase, [memberId]),
    loadAttendedMemberIds(createRepos(supabase).attendance, [memberId]),
    // bronze is admin-read-only; the intro channel's id is public to the workspace, so read just that.
    loadIntroChannelId(createServiceRoleClient()),
    loadCalendarFeedPrickleIds(supabase, memberId, now, now),
  ]);
  return {
    isNewcomer: true,
    introUrl: channelId ? `${SLACK_WORKSPACE_URL}/app_redirect?channel=${channelId}` : null,
    hasIntroduced: introduced.has(memberId),
    hasAttendedPrickle: attended.has(memberId),
    hasUpcomingPrickle: upcoming.size > 0,
  };
}

/**
 * The member's "Getting started" tour state, from their own data plus member_onboarding.
 * One round of parallel reads; memoized per render so the layout and any page share it.
 */
export const getOnboardingState = cache(async (memberId: string): Promise<OnboardingState> => {
  const supabase = await createClient();

  const now = new Date();
  const hostHistoryStart = new Date(now);
  hostHistoryStart.setMonth(hostHistoryStart.getMonth() - PICKER_HISTORY_MONTHS);
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);

  // Whether the tour shows depends only on the record, so check that first: a member who dismissed
  // or finished it skips the other twelve reads.
  const { data: record } = await supabase
    .from("member_onboarding")
    .select("marked_steps, dismissed_at, completed_at, acknowledged_steps")
    .eq("member_id", memberId)
    .maybeSingle();
  const recordData = (record as OnboardingRecord | null) ?? null;
  const idle = buildOnboardingState(NO_SIGNALS, recordData);
  // A finished tour may reopen for newly added steps, which only the real signals can tell.
  if (!idle.active && unseenStepIds(recordData).length === 0) return idle;

  const [
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
    feedToken,
    newcomer,
    bigSistersOn,
    birthday,
    slackStatus,
  ] = await Promise.all([
    // Written only when the member saves their bio or socials in the Hub. members.bio isn't read:
    // it's usually Kajabi's copy, which they haven't necessarily looked at here.
    supabase.from("member_profile_overrides").select("member_id").eq("member_id", memberId).maybeSingle(),
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
    supabase.from("calendar_feed_tokens").select("first_fetched_at").eq("member_id", memberId).maybeSingle(),
    loadNewcomerSignals(supabase, memberId, now),
    // The Big Sister step is behind the big_sisters preview (this member's own flag).
    membersWithFeature(createServiceRoleClient(), "big_sisters", [memberId]).then((on) => on.has(memberId)),
    supabase.from("members").select("birthday_month, birthday_day").eq("id", memberId).maybeSingle(),
    // Same gate as the Slack panel in Settings (SettingsPage): the Slack app is configured.
    isSlackConnectConfigured() ? getSlackConnectionStatus(createServiceRoleClient(), memberId) : Promise.resolve(null),
  ]);
  const mentorships = bigSistersOn
    ? await getMyMentorships(supabase, memberId, now.toISOString().slice(0, 10))
    : null;
  const latestScheduleMonth = (latestSchedule.data?.month as string | undefined) ?? null;

  const topics = (askMeAbout.data?.topics as string[] | null) ?? [];

  return buildOnboardingState(
    {
      hasHubProfile: override.data !== null || topics.length > 0,
      latestProjectId: latestProject.data?.id ?? null,
      hasGoal: (goals.count ?? 0) > 0,
      hasPricklePlan: (commitments.count ?? 0) > 0 || (calendarItems.count ?? 0) > 0,
      isHost: (hostedEver.count ?? 0) > 0 || latestScheduleMonth !== null,
      // Month strings are YYYY-MM-DD, so they compare as dates.
      hasHostingSchedule: latestScheduleMonth !== null && latestScheduleMonth >= currentMonth,
      hostedRecently: (hostedRecently.count ?? 0) > 0,
      hasHostVibe: (hostVibes.count ?? 0) > 0,
      hasCalendarSynced: !!feedToken.data?.first_fetched_at,
      hasBirthday: birthday.data?.birthday_month != null && birthday.data?.birthday_day != null,
      ...newcomer,
      slackConnect: slackStatus ? { connected: slackStatus.connected } : null,
      bigSisterName: mentorships?.bigSister?.name ?? null,
    },
    recordData
  );
});
