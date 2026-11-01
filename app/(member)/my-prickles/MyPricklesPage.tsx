import { getMemberDisplayName } from "@/lib/member-display-name";
import { createRepos } from "@/lib/data/repos";
import { attendedPrickleRow } from "@/lib/attendance-view";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { PRIORITY, getRankedUpcomingPrickles, type HighlightReason, type UpcomingPrickle } from "@/lib/upcoming-prickles";
import { getPrickleScheduleOverview } from "@/lib/prickle-schedule";
import { getMonthStart, getNextMonthStart, isMonthLocked } from "@/lib/prickle-schedules";
import { getMySchedules, getMyHostingStats, getMyHostEligibility } from "@/app/(member)/hosting/actions";
import MemberCalendarClient from "@/components/MemberCalendarClient";
import { loadDismissedCheckinIds } from "@/lib/prickle-checkin-dms";
import UpcomingPrickleRow from "@/components/UpcomingPrickleRow";
import PrickleWizard from "@/app/(member)/prickle-picker/PrickleWizard";
import HostingStats from "@/app/(member)/hosting/HostingStats";
import HostingScheduleManager from "@/app/(member)/hosting/HostingScheduleManager";
import AllPricklesView from "./AllPricklesView";
import CommitmentsManager from "./CommitmentsManager";
import { getMyCommitments } from "./commitment-actions";
import { getMyCalendarFeedUrls, getMyCalendarItems } from "./calendar-feed-actions";
import { slotKey, slotTimeForInstant } from "@/lib/commitments";
import { prickleCalendarState, SCHEDULE_TIMEZONE } from "@/lib/calendar-feed";
import CalendarSyncCard from "./CalendarSyncCard";
import AddedToCalendarList from "./AddedToCalendarList";
import { Tabs } from "@/components/Tabs";
import { RememberTabUrl } from "@/components/ReturnToTab";
import { ORG_TIMEZONE } from "@/lib/config";
import { getMyCheckins, type CheckinHalf } from "@/app/(member)/prickles/checkin-actions";
import type { CheckinInput } from "@/lib/prickle-checkins";

const UPCOMING_WINDOW_DAYS = 14;
const MAX_UPCOMING_DISPLAY = 8;
const SCHEDULE_LOOKBACK_DAYS = 90;

/** My Prickles tabs, at /my-prickles (Upcoming) and /my-prickles/<id> (lib/tab-routes.ts). */
import { MY_PRICKLES_TAB_IDS, MY_PRICKLES_TITLE, MY_PRICKLES_TAB_LABELS, type MyPricklesTabId } from "./tabs";
export { MY_PRICKLES_TAB_IDS, MY_PRICKLES_TITLE, MY_PRICKLES_TAB_LABELS, type MyPricklesTabId };

/**
 * My Prickles, rendered by /my-prickles and each /my-prickles/<tab> route with that tab open.
 * Every tab's data loads here, so switching tabs is instant. `commit` (All Prickles only, from
 * ?commit=<seriesKey>[,...]) opens commit mode with those slots picked; an empty value opens it
 * with nothing picked.
 */
export default async function MyPricklesPage({
  tab,
  commit,
  check,
}: {
  tab: MyPricklesTabId;
  commit?: string;
  /** History tab: open the check-in/check-out modal for this prickle on load (?checkin=<id> / ?checkout=<id>). */
  check?: { prickleId: string; half: CheckinHalf; prefill: CheckinInput | null };
}) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [effectiveIdentity, tzPref] = await Promise.all([getEffectiveIdentity(user), getUserTimezonePreference()]);
  if (!effectiveIdentity) redirect("/admin");

  // Hosting is behind the hosting preview (the sudo'd member's own flag in sudo); an old link opens Upcoming.
  const hostingOn = await effectiveMemberHasFeature("hosting", effectiveIdentity, await getUserFeaturePreviews(user.id));
  if (tab === "hosting" && !hostingOn) redirect("/my-prickles");

  const memberId = effectiveIdentity.memberId;
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  const initialCommitKeys = tab === "all" && commit != null ? commit.split(",").filter(Boolean) : null;

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  const [
    ranked,
    scheduleOverview,
    attendedPrickles,
    prickleTypes,
    schedules,
    lockRows,
    hostingStats,
    hostEligibility,
    members,
    commitments,
    calendarFeedUrls,
    calendarItems,
    checkins,
  ] = await Promise.all([
    getRankedUpcomingPrickles(createRepos(supabase), memberId, timeZone, now, UPCOMING_WINDOW_DAYS),
    getPrickleScheduleOverview(createRepos(supabase), now, timeZone, SCHEDULE_LOOKBACK_DAYS, UPCOMING_WINDOW_DAYS),
    createRepos(supabase).attendance.forMemberWithPrickles(memberId),
    createRepos(supabase).prickles.typesRequiringHost(),
    getMySchedules(),
    createRepos(supabase).prickleSchedules.locksOf([currentMonth, nextMonth]),
    getMyHostingStats(),
    getMyHostEligibility(),
    fetchOtherMembers(supabase, memberId),
    getMyCommitments(),
    getMyCalendarFeedUrls(),
    getMyCalendarItems(),
    getMyCheckins(),
  ]);

  const overrides = lockRows.map((r) => ({ month: r.month, locked: r.locked }));
  const currentMonthLocked = isMonthLocked(getMonthStart(now), overrides, now);
  const nextMonthLocked = isMonthLocked(getNextMonthStart(now), overrides, now);

  // Same ranking as Dashboard. Every prickle with a personal signal (hosting, commitment, added to
  // calendar, streak, sister) is shown however many there are; recommendations only fill the list
  // up to MAX_UPCOMING_DISPLAY -- this tab is a home for the member's own prickles, not a raw feed
  // of everything happening org-wide in the window.
  const personalCount = ranked.filter((r) => r.priority < PRIORITY.none).length;
  const displayedUpcoming = ranked.slice(0, Math.max(personalCount, MAX_UPCOMING_DISPLAY));
  const dismissedCheckins = await loadDismissedCheckinIds(supabase, memberId, displayedUpcoming.map((r) => r.prickle.id));

  // The "Add to my calendar" control on each upcoming row: what's already in their feed, and the
  // weekly slot an "every week" add would cover. Prickles with no type can't be added.
  const calendarFor = (prickle: UpcomingPrickle, reasons: HighlightReason[]) =>
    prickle.typeId
      ? {
          state: prickleCalendarState(
            calendarItems,
            prickle.id,
            slotKey({
              typeId: prickle.typeId,
              ...slotTimeForInstant(prickle.startTime, SCHEDULE_TIMEZONE),
              timezone: SCHEDULE_TIMEZONE,
            })
          ),
          nextLabel: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(
            new Date(prickle.startTime)
          ),
          autoIncluded: reasons.some((r) => r.kind === "hosting")
            ? ("hosting" as const)
            : reasons.some((r) => r.kind === "commitment")
              ? ("committed" as const)
              : null,
        }
      : null;

  // Active commitments' slots are already in the member's calendar feed.
  const committedSlotKeys = new Set(
    commitments.filter((c) => c.status === "active").flatMap((c) => c.slots.map((slot) => slotKey(slot)))
  );

  // Members who can't host yet get only the "Settle in first" welcome from
  // HostingScheduleManager (same condition), not an empty stats banner above it.
  const settleInFirst =
    schedules.length === 0 && hostingStats.totalHosted === 0 && !!hostEligibility && !hostEligibility.eligible;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">My Prickles</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            What&apos;s coming up, where you&apos;ve been, and the prickles you host.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Suspense fallback={null}>
          <RememberTabUrl path="/my-prickles" />
        </Suspense>
        <Tabs
          key={tab}
          initialTab={tab}
          basePath="/my-prickles"
          pageTitle={{ section: MY_PRICKLES_TITLE }}
          className="max-w-3xl mx-auto"
          tabs={[
            {
              id: "upcoming",
              label: MY_PRICKLES_TAB_LABELS.upcoming,
              content: (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
                  <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
                    For You — Next {UPCOMING_WINDOW_DAYS} Days
                  </h2>
                  {displayedUpcoming.length === 0 ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.{" "}
                      <Link data-track="my-prickles-see-the-full-schedule" href="/my-prickles/all" className="text-plum-600 dark:text-plum-400 hover:underline">
                        See the full schedule →
                      </Link>
                    </p>
                  ) : (
                    <div>
                      {displayedUpcoming.map(({ prickle, reasons }, index) => (
                        <UpcomingPrickleRow
                          key={prickle.id}
                          prickle={prickle}
                          reasons={reasons}
                          timeZone={timeZone}
                          checkin={checkins[prickle.id] ?? null}
                          checkinDismissed={dismissedCheckins.has(prickle.id)}
                          calendar={calendarFor(prickle, reasons)}
                          tourTarget={index === 0}
                        />
                      ))}
                      {ranked.length > displayedUpcoming.length && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                          Showing the top {displayedUpcoming.length} of {ranked.length}. Looking for something specific?{" "}
                          <Link data-track="my-prickles-see-all-prickles"
                            href="/my-prickles/all"
                            className="text-plum-600 dark:text-plum-400 hover:underline"
                          >
                            See all Prickles →
                          </Link>{" "}
                          or try{" "}
                          <Link data-track="my-prickles-find-a-prickle"
                            href="/my-prickles/find"
                            className="text-plum-600 dark:text-plum-400 hover:underline"
                          >
                            Find a Prickle →
                          </Link>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "all",
              label: MY_PRICKLES_TAB_LABELS.all,
              content: (
                <AllPricklesView
                  rows={scheduleOverview.rows}
                  instances={scheduleOverview.instances}
                  timeZone={timeZone}
                  upcomingWindowDays={UPCOMING_WINDOW_DAYS}
                  lookbackDays={SCHEDULE_LOOKBACK_DAYS}
                  initialCommitKeys={initialCommitKeys}
                  calendar={{ items: calendarItems, memberId, committedSlotKeys }}
                />
              ),
            },
            {
              id: "find",
              label: MY_PRICKLES_TAB_LABELS.find,
              content: (
                <div className="flex justify-center">
                  <PrickleWizard members={members} />
                </div>
              ),
            },
            {
              id: "commitments",
              label: MY_PRICKLES_TAB_LABELS.commitments,
              content: (
                <>
                  {/* Hugs the card so the Getting started tour's spotlight outlines just it. */}
                  {calendarFeedUrls && (
                    <div data-tour="calendar-sync">
                      <CalendarSyncCard initialUrls={calendarFeedUrls} />
                    </div>
                  )}
                  <CommitmentsManager commitments={commitments} />
                  <AddedToCalendarList items={calendarItems} />
                </>
              ),
            },
            ...(hostingOn
              ? [
                {
                  id: "hosting",
                  label: MY_PRICKLES_TAB_LABELS.hosting,
                  content: (
                    <div>
                      {!settleInFirst && calendarFeedUrls && <CalendarSyncCard initialUrls={calendarFeedUrls} />}
                      {!settleInFirst && <HostingStats stats={hostingStats} />}
                      <div data-tour="hosting-schedule">
                        <HostingScheduleManager
                          initialSchedules={schedules}
                          prickleTypes={prickleTypes}
                          currentMonth={currentMonth}
                          nextMonth={nextMonth}
                          currentMonthLocked={currentMonthLocked}
                          nextMonthLocked={nextMonthLocked}
                          hostEligibility={hostEligibility}
                          calendarHostedCount={hostingStats.totalHosted}
                        />
                      </div>
                    </div>
                  ),
                },
                ]
              : []),
            {
              id: "history",
              label: MY_PRICKLES_TAB_LABELS.history,
              content: (
                <MemberCalendarClient
                  memberId={memberId}
                  attendance={attendedPrickles.map(attendedPrickleRow)}
                  defaultTimezone={tzPref}
                  memberBasePath="/members"
                  initialView="list"
                  checkins={checkins}
                  initialCheck={check ?? null}
                />
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}

async function fetchOtherMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string
): Promise<{ id: string; name: string }[]> {
  // Public directory fields only -- other members' emails are admin-only (and this list is
  // passed to a client component).
  const members: { id: string; name: string }[] = (await createRepos(supabase).directory.all()).map((m) => ({
    id: m.id,
    name: getMemberDisplayName({ name: m.name, display_name: m.display_name }),
  }));
  // Exclude the hedgie herself from the "who do you want to see" picker.
  return members.filter((m) => m.id !== memberId);
}
