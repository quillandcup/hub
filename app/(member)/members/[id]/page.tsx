import { cache } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import type { Metadata } from "next"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import MemberAvatar from "./MemberAvatar"
import WelcomeBackBanner from "./WelcomeBackBanner"
import { parseDateOnly } from "@/lib/member-tenure"
import { getProfileWriting } from "@/app/(member)/projects/actions"
import { MEASURE_LABELS } from "@/lib/writing-projects"
import GoalDisplay from "@/components/writing/GoalDisplay"
import { getMemberBadges, getAttendedPrickleCount } from "@/lib/badges"
import BadgeChip from "@/components/BadgeChip"
import { safeUrl } from "@/lib/url"
import { getMemberDisplayName } from "@/lib/member-display-name"
import { fetchHostedPrickleRecords } from "@/lib/hosted-prickles"
import { computePublicHostingSummary } from "@/lib/hosting-stats"
import { getMemberHostingSchedule } from "@/lib/prickle-schedule"
import MemberHostingCard from "./MemberHostingCard"
import MemberNotesCard from "./MemberNotesCard"

const ORG_TIMEZONE = "America/New_York"
// Long enough to catch a monthly slot's next occurrence, not just weekly ones.
const HOSTING_SCHEDULE_WINDOW_DAYS = 35

/** "Sep 24", or "Sep 24, 2025" when it wasn't this year (both in the viewer's timezone). */
function formatLastPrickle(iso: string, now: Date, timeZone: string): string {
  const yearOf = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", timeZone })
  const date = new Date(iso)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(yearOf(date) === yearOf(now) ? {} : { year: "numeric" }),
    timeZone,
  })
}

const getMember = cache(async (id: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("member_directory")
    .select(
      "id, name, display_name, joined_at, first_joined_at, most_recent_joined_at, total_active_months, photo_url, bio, instagram_url, facebook_url, twitter_url"
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
  return { title: member ? getMemberDisplayName(member) : "Member" }
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const member = await getMember(id)

  if (!member) notFound()

  const writing = await getProfileWriting(id)

  // Everything below is Tier 3 (visible to all): the profile shows the same thing to the member
  // themselves as it shows to any other member, per docs -- no account info, engagement scores,
  // or prickle history (that's on My Prickles > Attendance History instead).
  // Private notes (Tier 1: author only) are skipped on your own profile and in sudo, where RLS
  // would resolve the admin as the author -- see app/(member)/members/[id]/noteActions.ts.
  const showNotes = member.id !== effectiveIdentity.memberId && !effectiveIdentity.isSudo
  const [{ data: booksData }, { data: awardsData }, tzPref, { data: askMeAboutRow }, { data: noteRow }] = await Promise.all([
    supabase
      .from("member_books")
      .select("id, title, cover_url, purchase_url, published_date")
      .eq("member_id", id)
      .order("published_date", { ascending: false }),
    supabase
      .from("member_awards")
      .select("id, award_name, category, work_title, award_date, url")
      .eq("member_id", id)
      .order("award_date", { ascending: false }),
    getUserTimezonePreference(),
    supabase.from("member_ask_me_about").select("topics").eq("member_id", id).maybeSingle(),
    showNotes
      ? supabase
          .from("member_notes")
          .select("body, updated_at")
          .eq("author_member_id", effectiveIdentity.memberId)
          .eq("subject_member_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const askMeAbout: string[] = askMeAboutRow?.topics ?? []
  const books = booksData ?? []
  const awards = awardsData ?? []
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref

  // Total prickles attended feeds the Badges section below. Computed live from prickle_attendance (distinct prickle_id, per CLAUDE.md) rather
  // than the member_metrics table, which nothing in the app populates -- see
  // docs/MEDALLION_ARCHITECTURE.md.
  // Hosting stats are the public subset only (no punctuality), and the schedule is the
  // member's upcoming calendar prickles grouped into recurring slots in the viewer's timezone.
  // "Last prickle" is the member's most recent join, shown in the header instead of stats.
  const now = new Date()
  const [totalPricklesAttended, hostedRecords, hostingSlots, { data: lastAttendance }] = await Promise.all([
    getAttendedPrickleCount(supabase, id),
    fetchHostedPrickleRecords(supabase, id, { now, includeAttendeeCounts: true }),
    getMemberHostingSchedule(supabase, id, now, timeZone, HOSTING_SCHEDULE_WINDOW_DAYS),
    supabase
      .from("prickle_attendance")
      .select("join_time")
      .eq("member_id", id)
      .lte("join_time", now.toISOString())
      .order("join_time", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const lastPrickleAt: string | null = lastAttendance?.join_time ?? null
  const hostingSummary = computePublicHostingSummary(hostedRecords)

  const earnedBadges = await getMemberBadges(
    supabase,
    id,
    totalPricklesAttended,
    member.first_joined_at
  )

  // No fallback to joined_at (Kajabi contact creation) — a lead who never
  // had a real subscription has no first_joined_at, and isn't a member, so
  // shows no "Hedgie since" line at all.
  const firstJoinedDate = member.first_joined_at ? parseDateOnly(member.first_joined_at) : null
  const formatMonthYear = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`

  const isRejoin = !!(
    member.most_recent_joined_at && member.most_recent_joined_at !== member.first_joined_at
  )
  const mostRecentJoinedDate = member.most_recent_joined_at ? parseDateOnly(member.most_recent_joined_at) : null
  const daysSinceRejoin = mostRecentJoinedDate
    ? Math.floor((now.getTime() - mostRecentJoinedDate.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity
  const showWelcomeBack = isRejoin && daysSinceRejoin <= 30

  const totalActiveMonths = member.total_active_months ?? 0
  const hedgieYears = Math.floor(totalActiveMonths / 12)
  const hedgieMonthsRemainder = totalActiveMonths % 12
  const hedgieversaryLabel =
    hedgieYears > 0
      ? `${hedgieYears}-year Hedgieversary${hedgieMonthsRemainder > 0 ? ` + ${hedgieMonthsRemainder} mo` : ""}`
      : `${totalActiveMonths} ${totalActiveMonths === 1 ? "month" : "months"} as a Hedgie`

  const safeTwitter = safeUrl(member.twitter_url)
  const safeInstagram = safeUrl(member.instagram_url)
  const safeFacebook = safeUrl(member.facebook_url)
  const safePhoto = safeUrl(member.photo_url)
  const displayName = getMemberDisplayName(member)

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <MemberAvatar name={displayName} photoUrl={safePhoto} size={56} />
        <div>
          <h1 className="text-3xl font-bold">{displayName}</h1>
          {firstJoinedDate && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Hedgie since {formatMonthYear(firstJoinedDate)}
              {totalActiveMonths > 0 && <span className="mx-1.5">·</span>}
              {totalActiveMonths > 0 && <span>{hedgieversaryLabel}</span>}
            </p>
          )}
          {lastPrickleAt && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Last prickle {formatLastPrickle(lastPrickleAt, now, timeZone)}
            </p>
          )}
        </div>
        {member.id === effectiveIdentity.memberId && (
          <Link
            href="/settings?tab=profile"
            className="ml-auto shrink-0 text-sm px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Edit profile
          </Link>
        )}
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
        <p className="text-slate-700 dark:text-slate-300 mb-6 leading-relaxed whitespace-pre-line">
          {member.bio}
        </p>
      )}

      {askMeAbout.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Ask me about…</h2>
          <ul className="flex flex-wrap gap-1.5">
            {askMeAbout.map((topic) => (
              <li key={topic}>
                <Link
                  href={`/members?q=${encodeURIComponent(topic)}`}
                  className="inline-block rounded-full bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 text-sm px-3 py-1 hover:bg-plum-100 dark:hover:bg-plum-900/50"
                  title={`Find other Hedgies who talk about ${topic}`}
                >
                  {topic}
                </Link>
              </li>
            ))}
          </ul>
        </div>
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

      {showNotes && (
        <MemberNotesCard
          subjectMemberId={member.id}
          firstName={displayName.split(" ")[0]}
          initialBody={noteRow?.body ?? ""}
          initialUpdatedAt={noteRow?.updated_at ?? null}
        />
      )}

      {/* Tier 3: visible to all -- renders nothing for members who don't host */}
      <MemberHostingCard
        summary={hostingSummary}
        slots={hostingSlots}
        timeZone={timeZone}
        firstName={displayName.split(" ")[0]}
      />

      {/* Tier 3: visible to all */}
      {earnedBadges.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            {earnedBadges.map((badge) => (
              <BadgeChip
                key={badge.badgeType.id}
                badge={badge}
                href={badge.badgeType.event_slug ? `/events/${badge.badgeType.event_slug}` : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tier 3: visible to all -- only projects and goals the member opted in via "Show on my profile" */}
      {(writing.projects.length > 0 || writing.goals.length > 0) && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Writing Progress
          </h2>
          {writing.projects.length > 0 && (
            <ul className="space-y-2">
              {writing.projects.map((project) => (
                <li key={project.id} className="flex items-baseline gap-2">
                  {project.headline ? (
                    <>
                      <span className="text-3xl font-bold">{project.headline.total.toLocaleString()}</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {MEASURE_LABELS[project.headline.measure].toLowerCase()} on {project.title}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">{project.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {writing.goals.length > 0 && (
            <div className={`space-y-4 ${writing.projects.length > 0 ? "mt-6" : ""}`}>
              {writing.goals.map((goal) => (
                <div key={goal.id}>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{goal.projectTitle}</p>
                  <GoalDisplay goal={goal} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tier 3: visible to all */}
      {books.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Published Books
          </h2>
          <ul className="space-y-3">
            {books.map((book) => {
              const safeCover = safeUrl(book.cover_url)
              const safePurchase = safeUrl(book.purchase_url)
              return (
                <li key={book.id} className="flex items-center gap-3">
                  {safeCover && (
                    <img
                      src={safeCover}
                      alt=""
                      className="w-10 h-14 object-cover rounded flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    {safePurchase ? (
                      <a
                        href={safePurchase}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline"
                      >
                        {book.title}
                      </a>
                    ) : (
                      <p className="text-sm font-medium">{book.title}</p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatMonthYear(parseDateOnly(book.published_date))}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Tier 3: visible to all */}
      {awards.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Awards
          </h2>
          <ul className="space-y-3">
            {awards.map((award) => {
              const safeAwardUrl = safeUrl(award.url)
              return (
                <li key={award.id}>
                  <p className="text-sm font-medium">
                    🏆 {award.award_name}
                    {award.category && (
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {" "}
                        — {award.category}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    for &ldquo;{award.work_title}&rdquo; · {formatMonthYear(parseDateOnly(award.award_date))}
                    {safeAwardUrl && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={safeAwardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          details
                        </a>
                      </>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
