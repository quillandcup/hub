import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { getStarredGoals, getUnloggedRecentPrickles } from "../projects/actions"
import UnloggedPricklesCard from "@/components/writing/UnloggedPricklesCard"
import GoalDisplay from "@/components/writing/GoalDisplay"
import UpcomingPrickleRow from "@/components/UpcomingPrickleRow"
import { loadDismissedCheckinIds } from "@/lib/prickle-checkin-dms"
import { getRankedUpcomingPrickles } from "@/lib/upcoming-prickles"
import { ORG_TIMEZONE } from "@/lib/config";
import { getMyCheckins } from "@/app/(member)/prickles/checkin-actions";
import { getMyMentorships } from "@/lib/my-mentorship";
import { getSlackDmLinksForMembers } from "@/lib/member-slack-links";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import BigSisterCards from "@/components/member/BigSisterCards";

export const metadata: Metadata = {
  title: "Dashboard",
}

const UPCOMING_WINDOW_DAYS = 7
const MAX_UPCOMING_DISPLAY = 5
const MAX_UNLOGGED_DISPLAY = 5

export default async function DashboardPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const [effectiveIdentity, tzPref] = await Promise.all([
    getEffectiveIdentity(user),
    getUserTimezonePreference(),
  ])
  if (!effectiveIdentity) redirect("/admin")

  const memberId = effectiveIdentity.memberId
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref

  const now = new Date()

  // Big Sister cards are behind the big_sisters preview.
  const bigSistersOn = await effectiveMemberHasFeature(
    "big_sisters",
    effectiveIdentity,
    await getUserFeaturePreviews(user.id)
  )

  const [ranked, starredGoals, { data: projectRows }, unlogged, checkins, mentorships] = await Promise.all([
    getRankedUpcomingPrickles(supabase, memberId, timeZone, now, UPCOMING_WINDOW_DAYS),
    getStarredGoals(),
    supabase
      .from("writing_projects")
      .select("id, title")
      .eq("member_id", memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    getUnloggedRecentPrickles(),
    getMyCheckins(),
    bigSistersOn
      ? getMyMentorships(supabase, memberId, now.toISOString().slice(0, 10))
      : Promise.resolve({ bigSister: null, mentees: [] }),
  ])
  // Only this member's own partners, since the Slack lookup uses the service role.
  const slackLinks = Object.fromEntries(
    await getSlackDmLinksForMembers(
      [mentorships.bigSister?.memberId, ...mentorships.mentees.map((m) => m.memberId)].filter(
        (id): id is string => !!id
      )
    )
  )
  const projects = projectRows ?? []
  // Only prompt members who track writing -- there's no progress to ask about otherwise.
  const unloggedPrickles =
    projects.length > 0
      ? unlogged.slice(0, MAX_UNLOGGED_DISPLAY)
      : []
  const upcoming = ranked.map((r) => r.prickle)
  const displayedUpcoming = ranked.slice(0, MAX_UPCOMING_DISPLAY)
  const dismissedCheckins = await loadDismissedCheckinIds(supabase, memberId, displayedUpcoming.map((r) => r.prickle.id))

  const firstName = (effectiveIdentity.memberDisplayName ?? effectiveIdentity.memberName)?.split(" ")[0]

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
        Here&apos;s what&apos;s coming up in the next {UPCOMING_WINDOW_DAYS} days.
      </p>

      <BigSisterCards mentorships={mentorships} slackLinks={slackLinks} linkToPage />

      {starredGoals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
            Writing Goals
          </h2>
          <div className="space-y-4">
            {starredGoals.map((goal) => (
              <div key={goal.id}>
                <Link
                  href={`/projects/${goal.projectId}`}
                  data-track="dashboard-goal-project"
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400"
                >
                  {goal.projectTitle}
                </Link>
                <div className="mt-1">
                  <GoalDisplay goal={goal} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {unloggedPrickles.length > 0 && <UnloggedPricklesCard prickles={unloggedPrickles} />}

      {upcoming.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.
          </p>
          <Link
            href="/my-prickles"
            data-track="dashboard-find-a-prickle"
            className="inline-block mt-3 text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400"
          >
            Find a prickle →
          </Link>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
            Upcoming Prickles
          </h2>
          <div>
            {displayedUpcoming.map(({ prickle, reasons }) => (
              <UpcomingPrickleRow
                key={prickle.id}
                prickle={prickle}
                reasons={reasons}
                timeZone={timeZone}
                checkin={checkins[prickle.id] ?? null}
                checkinDismissed={dismissedCheckins.has(prickle.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
