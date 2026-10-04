import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { PRIORITY, getRankedUpcomingPrickles } from "@/lib/upcoming-prickles";
import { getPrickleScheduleOverview } from "@/lib/prickle-schedule";
import { getMonthStart, getNextMonthStart, isMonthLocked } from "@/lib/prickle-schedules";
import { getMySchedules, getMyHostingStats, getMyHostEligibility } from "@/app/(member)/hosting/actions";
import MemberCalendarClient from "@/components/MemberCalendarClient";
import UpcomingPrickleRow from "@/components/UpcomingPrickleRow";
import PrickleWizard from "@/app/(member)/prickle-picker/PrickleWizard";
import HostingStats from "@/app/(member)/hosting/HostingStats";
import HostingScheduleManager from "@/app/(member)/hosting/HostingScheduleManager";
import AllPricklesView from "./AllPricklesView";
import CommitmentsManager from "./CommitmentsManager";
import { getMyCommitments } from "./commitment-actions";
import { getMyCalendarFeedUrls, getMyCalendarItems } from "./calendar-feed-actions";
import { slotKey } from "@/lib/commitments";
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
const MEMBERS_BATCH_SIZE = 1000;

/** My Prickles tabs, at /my-prickles (Upcoming) and /my-prickles/<id> (lib/tab-routes.ts). */
export const MY_PRICKLES_TAB_IDS = ["upcoming", "all", "find", "commitments", "hosting", "history"] as const;
export type MyPricklesTabId = (typeof MY_PRICKLES_TAB_IDS)[number];
export const MY_PRICKLES_TITLE = "My Prickles";
export const MY_PRICKLES_TAB_LABELS: Record<MyPricklesTabId, string> = {
  upcoming: "Upcoming",
  all: "All Prickles",
  find: "Find a Prickle",
  commitments: "Commitments",
  hosting: "Hosting",
  history: "Attendance History",
};

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

  const memberId = effectiveIdentity.memberId;
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  const initialCommitKeys = tab === "all" && commit != null ? commit.split(",").filter(Boolean) : null;

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  const [
    ranked,
    scheduleOverview,
    { data: attendance },
    { data: prickleTypes },
    schedules,
    { data: lockRows },
    hostingStats,
    hostEligibility,
    members,
    commitments,
    calendarFeedUrls,
    calendarItems,
    checkins,
  ] = await Promise.all([
    getRankedUpcomingPrickles(supabase, memberId, timeZone, now, UPCOMING_WINDOW_DAYS),
    getPrickleScheduleOverview(supabase, now, timeZone, SCHEDULE_LOOKBACK_DAYS, UPCOMING_WINDOW_DAYS),
    supabase
      .from("prickle_attendance")
      .select(
        `id, join_time, leave_time, prickles(id, host:prickle_host(id, name), start_time, end_time, prickle_types(name))`
      )
      .eq("member_id", memberId)
      .order("join_time", { ascending: false }),
    supabase.from("prickle_types").select("id, name").eq("requires_host", true).order("name"),
    getMySchedules(),
    supabase.from("prickle_schedule_locks").select("month, locked").in("month", [currentMonth, nextMonth]),
    getMyHostingStats(),
    getMyHostEligibility(),
    fetchOtherMembers(supabase, memberId),
    getMyCommitments(),
    getMyCalendarFeedUrls(),
    getMyCalendarItems(),
    getMyCheckins(),
  ]);

  const overrides = (lockRows ?? []).map((r) => ({ month: r.month as string, locked: r.locked as boolean }));
  const currentMonthLocked = isMonthLocked(getMonthStart(now), overrides, now);
  const nextMonthLocked = isMonthLocked(getNextMonthStart(now), overrides, now);

  // Same ranking as Dashboard. Every prickle with a personal signal (hosting, commitment, added to
  // calendar, streak, sister) is shown however many there are; recommendations only fill the list
  // up to MAX_UPCOMING_DISPLAY -- this tab is a home for the member's own prickles, not a raw feed
  // of everything happening org-wide in the window.
  const personalCount = ranked.filter((r) => r.priority < PRIORITY.none).length;
  const displayedUpcoming = ranked.slice(0, Math.max(personalCount, MAX_UPCOMING_DISPLAY));

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
                  <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                    For You — Next {UPCOMING_WINDOW_DAYS} Days
                  </h2>
                  {displayedUpcoming.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.{" "}
                      <Link href="/my-prickles/all" className="text-plum-600 dark:text-plum-400 hover:underline">
                        See the full schedule →
                      </Link>
                    </p>
                  ) : (
                    <div>
                      {displayedUpcoming.map(({ prickle, reasons }) => (
                        <UpcomingPrickleRow key={prickle.id} prickle={prickle} reasons={reasons} timeZone={timeZone} />
                      ))}
                      {ranked.length > displayedUpcoming.length && (
                        <p className="text-xs text-slate-400 mt-3">
                          Showing the top {displayedUpcoming.length} of {ranked.length}. Looking for something specific?{" "}
                          <Link
                            href="/my-prickles/all"
                            className="text-plum-600 dark:text-plum-400 hover:underline"
                          >
                            See all Prickles →
                          </Link>{" "}
                          or try{" "}
                          <Link
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
                  {/* Hugs the wizard so the Getting started tour's spotlight outlines just it. */}
                  <div data-tour="find-prickle">
                    <PrickleWizard members={members} />
                  </div>
                </div>
              ),
            },
            {
              id: "commitments",
              label: MY_PRICKLES_TAB_LABELS.commitments,
              content: (
                <>
                  {calendarFeedUrls && <CalendarSyncCard initialUrls={calendarFeedUrls} />}
                  <CommitmentsManager commitments={commitments} />
                  <AddedToCalendarList items={calendarItems} />
                </>
              ),
            },
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
                      prickleTypes={prickleTypes ?? []}
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
            {
              id: "history",
              label: MY_PRICKLES_TAB_LABELS.history,
              content: (
                <MemberCalendarClient
                  memberId={memberId}
                  attendance={attendance || []}
                  defaultTimezone={tzPref}
                  memberBasePath="/members"
                  initialView={check ? "list" : "month"}
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
  let members: { id: string; name: string }[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("member_directory")
      .select("id, name")
      .order("name")
      .order("id")
      .range(offset, offset + MEMBERS_BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      members = members.concat(batch);
      offset += batch.length;
      hasMore = batch.length === MEMBERS_BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  // Exclude the hedgie herself from the "who do you want to see" picker.
  return members.filter((m) => m.id !== memberId);
}
