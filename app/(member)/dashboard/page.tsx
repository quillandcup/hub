import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { getStarredGoals } from "../projects/actions"
import GoalDisplay from "@/components/writing/GoalDisplay"
import UpcomingPrickleRow from "@/components/UpcomingPrickleRow"
import { getRankedUpcomingPrickles } from "@/lib/upcoming-prickles"

export const metadata: Metadata = {
  title: "Dashboard",
}

const ORG_TIMEZONE = "America/New_York"
const UPCOMING_WINDOW_DAYS = 7
const MAX_UPCOMING_DISPLAY = 5

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

  const [ranked, starredGoals] = await Promise.all([
    getRankedUpcomingPrickles(supabase, memberId, timeZone, now, UPCOMING_WINDOW_DAYS),
    getStarredGoals(),
  ])
  const upcoming = ranked.map((r) => r.prickle)
  const displayedUpcoming = ranked.slice(0, MAX_UPCOMING_DISPLAY)

  const firstName = effectiveIdentity.memberName?.split(" ")[0]

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
        Here&apos;s what&apos;s coming up in the next {UPCOMING_WINDOW_DAYS} days.
      </p>

      {starredGoals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Writing Goals
          </h2>
          <div className="space-y-4">
            {starredGoals.map((goal) => (
              <div key={goal.id}>
                <Link
                  href={`/projects/${goal.projectId}`}
                  className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
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

      {upcoming.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.
          </p>
          <Link
            href="/my-prickles"
            className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Find a prickle →
          </Link>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Upcoming Prickles
          </h2>
          <div>
            {displayedUpcoming.map(({ prickle, reasons }) => (
              <UpcomingPrickleRow key={prickle.id} prickle={prickle} reasons={reasons} timeZone={timeZone} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
