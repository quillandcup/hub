import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import type { Metadata } from "next"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { computeStreaks } from "@/lib/streaks"
import MemberAvatar from "./MemberAvatar"
import WelcomeBackBanner from "./WelcomeBackBanner"
import { parseDateOnly } from "@/lib/member-tenure"
import { getProfileWritingSummary } from "@/app/(member)/projects/actions"
import { MEASURE_LABELS } from "@/lib/writing-projects"
import { getMemberBadges } from "@/lib/badges"
import BadgeChip from "@/components/BadgeChip"
import { safeUrl } from "@/lib/url"

const ORG_TIMEZONE = "America/New_York"

const getMember = cache(async (id: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("members")
    .select(
      "id, name, email, joined_at, first_joined_at, most_recent_joined_at, total_active_months, status, photo_url, bio, instagram_url, facebook_url, twitter_url"
    )
    .eq("id", id)
    .single()
  return data
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const member = await getMember(id)
  return { title: member?.name ?? "Member" }
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const isSelf = effectiveIdentity.memberId === id

  const member = await getMember(id)

  if (!member) notFound()

  const writingSummary = await getProfileWritingSummary(id)

  let metrics: {
    member_id: string
    last_attended_at: string | null
    sessions_last_7_days: number
    sessions_last_30_days: number
    total_sessions: number
    engagement_score: number
    updated_at: string
  } | null = null
  let attendance: {
    id: string
    join_time: string
    leave_time: string
    prickles: { start_time: string; prickle_types: { name: string } | null } | null
  }[] = []
  let streakJoinTimes: string[] = []
  let timeZone = ORG_TIMEZONE

  // Metrics (total prickles attended) feed both the Tier 3 "Community Stats" card and the
  // Badges section below, so they're fetched regardless of viewer -- not just for isSelf.
  const { data: metricsData } = await supabase
    .from("member_metrics")
    .select("*")
    .eq("member_id", id)
    .single()
  metrics = metricsData

  if (isSelf) {
    // Fetch history and timezone preference concurrently (all bounded)
    const [{ data: historyData }, tzPref] = await Promise.all([
      supabase
        .from("prickle_attendance")
        .select("id, join_time, leave_time, prickles(start_time, prickle_types(name))")
        .eq("member_id", id)
        .order("join_time", { ascending: false })
        .limit(50),
      getUserTimezonePreference(),
    ])
    timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref
    attendance = (historyData ?? []) as unknown as typeof attendance

    // Paginate all join_times for streak computation (sequential by nature)
    const BATCH_SIZE = 1000
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickle_attendance")
        .select("join_time")
        .eq("member_id", id)
        .range(offset, offset + BATCH_SIZE - 1)
      if (batch && batch.length > 0) {
        streakJoinTimes = streakJoinTimes.concat(batch.map((r) => r.join_time))
        offset += batch.length
        hasMore = batch.length === BATCH_SIZE
      } else {
        hasMore = false
      }
    }
  }

  const earnedBadges = await getMemberBadges(
    supabase,
    id,
    metrics?.total_sessions ?? 0,
    member.first_joined_at
  )

  const streaks = computeStreaks(streakJoinTimes, new Date(), timeZone)

  // No fallback to joined_at (Kajabi contact creation) — a lead who never
  // had a real subscription has no first_joined_at, and isn't a member, so
  // shows no "Member since" line at all.
  const firstJoinedDate = member.first_joined_at ? parseDateOnly(member.first_joined_at) : null
  const formatMonthYear = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`

  const isRejoin = !!(
    member.most_recent_joined_at && member.most_recent_joined_at !== member.first_joined_at
  )
  const mostRecentJoinedDate = member.most_recent_joined_at ? parseDateOnly(member.most_recent_joined_at) : null
  const daysSinceRejoin = mostRecentJoinedDate
    ? Math.floor((Date.now() - mostRecentJoinedDate.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity
  const showWelcomeBack = isRejoin && daysSinceRejoin <= 30

  const totalActiveMonths = member.total_active_months ?? 0
  const hedgieYears = Math.floor(totalActiveMonths / 12)
  const hedgieMonthsRemainder = totalActiveMonths % 12
  const hedgieversaryLabel =
    hedgieYears > 0
      ? `${hedgieYears}-year Hedgieversary${hedgieMonthsRemainder > 0 ? ` + ${hedgieMonthsRemainder} mo` : ""}`
      : `${totalActiveMonths} ${totalActiveMonths === 1 ? "month" : "months"} as a Hedgie`

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  }
  const statusLabel: Record<string, string> = {
    active: "Active",
    on_hiatus: "On Hiatus",
    inactive: "Inactive",
  }

  const safeTwitter = safeUrl(member.twitter_url)
  const safeInstagram = safeUrl(member.instagram_url)
  const safeFacebook = safeUrl(member.facebook_url)
  const safePhoto = safeUrl(member.photo_url)

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <MemberAvatar name={member.name} photoUrl={safePhoto} size={56} />
        <div>
          <h1 className="text-3xl font-bold">{member.name}</h1>
          {firstJoinedDate && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Member since {formatMonthYear(firstJoinedDate)}
              {totalActiveMonths > 0 && <span className="mx-1.5">·</span>}
              {totalActiveMonths > 0 && <span>{hedgieversaryLabel}</span>}
            </p>
          )}
        </div>
      </div>

      {showWelcomeBack && mostRecentJoinedDate && (
        <WelcomeBackBanner
          memberId={member.id}
          rejoinedAt={member.most_recent_joined_at!}
          monthLabel={formatMonthYear(mostRecentJoinedDate)}
        />
      )}

      {/* Bio */}
      {member.bio && (
        <p className="text-slate-700 dark:text-slate-300 mb-6 leading-relaxed">
          {member.bio}
        </p>
      )}

      {/* Social links */}
      {(safeInstagram || safeFacebook || safeTwitter) && (
        <div className="flex items-center gap-4 mb-6">
          {safeTwitter && (
            <a
              href={safeTwitter}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              aria-label="Twitter / X"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          )}
          {safeInstagram && (
            <a
              href={safeInstagram}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              aria-label="Instagram"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
            </a>
          )}
          {safeFacebook && (
            <a
              href={safeFacebook}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              aria-label="Facebook"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Tier 3: visible to all */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Community Stats
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold">{metrics?.total_sessions ?? 0}</span>
          <span className="text-slate-500 dark:text-slate-400">prickles attended</span>
        </div>
      </div>

      {/* Tier 3: visible to all */}
      {earnedBadges.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            {earnedBadges.map((badge) => (
              <BadgeChip key={badge.badgeType.id} badge={badge} />
            ))}
          </div>
        </div>
      )}

      {/* Tier 3: visible to all -- only shown if the member opted a project in via "Show on my profile" */}
      {writingSummary && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Writing Progress
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold">{writingSummary.total.toLocaleString()}</span>
            <span className="text-slate-500 dark:text-slate-400">
              {MEASURE_LABELS[writingSummary.measure].toLowerCase()} on {writingSummary.projectTitle}
            </span>
          </div>
        </div>
      )}

      {/* Tier 2: self only */}
      {isSelf && (
        <>
          {/* Account info */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Account
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
                <p className="text-sm font-medium">{member.email}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Status</span>
                <div className="mt-1">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[member.status] ?? statusColors.inactive
                    }`}
                  >
                    {statusLabel[member.status] ?? member.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Engagement metrics */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Engagement
            </h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_7_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 7 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_30_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 30 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.total_sessions ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">All time</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.currentStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.currentStreak === 1 ? "week" : "weeks"} current streak
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.longestStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.longestStreak === 1 ? "week" : "weeks"} best streak
                </p>
              </div>
            </div>
          </div>

          {/* Prickle history */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Prickle History{attendance.length === 50 ? " (last 50)" : ""}
            </h2>
            {attendance.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No prickles attended yet.</p>
            ) : (
              <div className="space-y-2">
                {attendance.map((record) => {
                  const joinDate = new Date(record.join_time)
                  const durationMin = Math.round(
                    (new Date(record.leave_time).getTime() - joinDate.getTime()) / 60000
                  )
                  const prickleName = record.prickles?.prickle_types?.name ?? "Prickle"
                  const dateStr = joinDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                  return (
                    <div
                      key={record.id}
                      className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0"
                    >
                      <div>
                        <span className="text-sm font-medium">{prickleName}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{dateStr}</span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {durationMin} min
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
