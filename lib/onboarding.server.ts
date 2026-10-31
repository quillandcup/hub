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
  const member = await createRepos(supabase).members.byId(memberId);
  if (!isNewcomer(member?.firstJoinedAt, now)) return none;

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
  // A failed read counts as no record: the tour is not worth failing the layout for.
  const recordData: OnboardingRecord | null = await createRepos(supabase)
    .memberProfile.onboardingOf(memberId)
    .catch((error) => {
      console.error("onboarding: failed to read the tour state", error);
      return null;
    });
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
    feedFetched,
    newcomer,
    bigSistersOn,
    birthday,
    slackStatus,
    chatOn,
    hostingOn,
  ] = await Promise.all([
    // Written only when the member saves their bio or socials in the Hub. members.bio isn't read:
    // it's usually Kajabi's copy, which they haven't necessarily looked at here.
    createRepos(supabase).memberStatus.profileOverrideOf(memberId),
    createRepos(supabase).memberProfile.askMeAbout(memberId).catch((error) => {
      console.error("onboarding: failed to read ask-me-about", error);
      return [] as string[];
    }),
    createRepos(supabase).writing.latestActiveProjectId(memberId),
    createRepos(supabase).writing.goalCount(memberId),
    // A failed count reads as none: the checklist still renders.
    createRepos(supabase).prickleActivity.countActiveCommitments(memberId).catch((error) => {
      console.error("onboarding: failed to count commitments", error);
      return 0;
    }),
    // A failed read counts as none: the checklist still renders.
    createRepos(supabase).calendarFeed.countItems(memberId).catch((error) => {
      console.error("onboarding: failed to count calendar items", error);
      return 0;
    }),
    createRepos(supabase).prickles.countHostedBy(memberId),
    createRepos(supabase).prickles.countHostedBy(memberId, { since: hostHistoryStart.toISOString() }),
    createRepos(supabase).prickleSchedules.latestMonthOf(memberId),
    supabase.from("prickle_host_vibes").select("type_id", { count: "exact", head: true }).eq("host_id", memberId),
    createRepos(supabase).calendarFeed.hasBeenFetched(memberId).catch((error) => {
      console.error("onboarding: failed to read the calendar feed", error);
      return false;
    }),
    loadNewcomerSignals(supabase, memberId, now),
    // The Big Sister step is behind the big_sisters preview (this member's own flag).
    membersWithFeature(createServiceRoleClient(), "big_sisters", [memberId]).then((on) => on.has(memberId)),
    createRepos(supabase).members.profile(memberId),
    // Same gate as the Slack panel in Settings (SettingsPage): the Slack app is configured.
    isSlackConnectConfigured() ? getSlackConnectionStatus(createServiceRoleClient(), memberId) : Promise.resolve(null),
    // Chat needs the connection, so for someone who has it the Slack step can't be skipped.
    membersWithFeature(createServiceRoleClient(), "chat", [memberId]).then((on) => on.has(memberId)),
    // The hosting steps are behind the hosting preview (this member's own flag).
    membersWithFeature(createServiceRoleClient(), "hosting", [memberId]).then((on) => on.has(memberId)),
  ]);
  const mentorships = bigSistersOn
    ? await getMyMentorships(createRepos(supabase).mentorship, memberId, now.toISOString().slice(0, 10))
    : null;
  const latestScheduleMonth = latestSchedule;

  const topics = askMeAbout;

  return buildOnboardingState(
    {
      hasHubProfile: override !== null || topics.length > 0,
      latestProjectId: latestProject,
      hasGoal: goals > 0,
      hasPricklePlan: commitments > 0 || calendarItems > 0,
      isHost: hostingOn && (hostedEver > 0 || latestScheduleMonth !== null),
      // Month strings are YYYY-MM-DD, so they compare as dates.
      hasHostingSchedule: latestScheduleMonth !== null && latestScheduleMonth >= currentMonth,
      hostedRecently: hostedRecently > 0,
      hasHostVibe: (hostVibes.count ?? 0) > 0,
      hasCalendarSynced: feedFetched,
      hasBirthday: birthday?.birthdayMonth != null && birthday?.birthdayDay != null,
      ...newcomer,
      slackConnect: slackStatus ? { connected: slackStatus.connected && slackStatus.sharesReadState, required: chatOn } : null,
      bigSisterName: mentorships?.bigSister?.name ?? null,
    },
    recordData
  );
});
