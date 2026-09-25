import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getRankedUpcomingPrickles } from "@/lib/upcoming-prickles";
import { getMonthStart, getNextMonthStart, isMonthLocked } from "@/lib/prickle-schedules";
import { getMySchedules, getMyHostingStats } from "@/app/(member)/hosting/actions";
import MemberCalendarClient from "@/components/MemberCalendarClient";
import UpcomingPrickleRow from "@/components/UpcomingPrickleRow";
import PrickleWizard from "@/app/(member)/prickle-picker/PrickleWizard";
import HostingStats from "@/app/(member)/hosting/HostingStats";
import HostingScheduleManager from "@/app/(member)/hosting/HostingScheduleManager";
import { MyPricklesTabs } from "./MyPricklesTabs";

export const metadata: Metadata = {
  title: "My Prickles",
};

const ORG_TIMEZONE = "America/New_York";
const UPCOMING_WINDOW_DAYS = 30;
const MEMBERS_BATCH_SIZE = 1000;

const TAB_IDS = ["upcoming", "history", "find", "hosting"] as const;
type TabId = (typeof TAB_IDS)[number];

export default async function MyPricklesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [effectiveIdentity, tzPref, enabledFeatures] = await Promise.all([
    getEffectiveIdentity(user),
    getUserTimezonePreference(),
    getUserFeaturePreviews(user.id),
  ]);
  if (!effectiveIdentity) redirect("/admin");

  const memberId = effectiveIdentity.memberId;
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;
  const canFindPrickle = enabledFeatures.includes("prickle_picker");

  const { tab: rawTab } = await searchParams;
  const requestedTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "") ? (rawTab as TabId) : "upcoming";
  const initialTab: TabId = requestedTab === "find" && !canFindPrickle ? "upcoming" : requestedTab;

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  const [ranked, { data: attendance }, { data: prickleTypes }, schedules, { data: lockRows }, hostingStats, members] =
    await Promise.all([
      getRankedUpcomingPrickles(supabase, memberId, timeZone, now, UPCOMING_WINDOW_DAYS),
      supabase
        .from("prickle_attendance")
        .select(
          `id, join_time, leave_time, prickles(id, host:members(id, name), start_time, end_time, prickle_types(name))`
        )
        .eq("member_id", memberId)
        .order("join_time", { ascending: false }),
      supabase.from("prickle_types").select("id, name").eq("requires_host", true).order("name"),
      getMySchedules(),
      supabase.from("prickle_schedule_locks").select("month, locked").in("month", [currentMonth, nextMonth]),
      getMyHostingStats(),
      canFindPrickle ? fetchOtherMembers(supabase, memberId) : Promise.resolve([]),
    ]);

  const overrides = (lockRows ?? []).map((r) => ({ month: r.month as string, locked: r.locked as boolean }));
  const currentMonthLocked = isMonthLocked(getMonthStart(now), overrides, now);
  const nextMonthLocked = isMonthLocked(getNextMonthStart(now), overrides, now);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">My Prickles</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            What&apos;s coming up, where you&apos;ve been, and the prickles you host.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MyPricklesTabs
          initialTab={initialTab}
          upcomingContent={
            <div className="max-w-2xl bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
              <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                Next {UPCOMING_WINDOW_DAYS} Days
              </h2>
              {ranked.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.
                </p>
              ) : (
                <div>
                  {ranked.map(({ prickle, reasons }) => (
                    <UpcomingPrickleRow key={prickle.id} prickle={prickle} reasons={reasons} timeZone={timeZone} />
                  ))}
                </div>
              )}
            </div>
          }
          historyContent={
            <MemberCalendarClient
              memberId={memberId}
              attendance={attendance || []}
              defaultTimezone={tzPref}
              memberBasePath="/members"
              initialView="month"
            />
          }
          findContent={
            canFindPrickle ? (
              <div className="flex justify-center">
                <PrickleWizard members={members} />
              </div>
            ) : null
          }
          hostingContent={
            <div className="max-w-3xl">
              <HostingStats stats={hostingStats} />
              <HostingScheduleManager
                initialSchedules={schedules}
                prickleTypes={prickleTypes ?? []}
                currentMonth={currentMonth}
                nextMonth={nextMonth}
                currentMonthLocked={currentMonthLocked}
                nextMonthLocked={nextMonthLocked}
              />
            </div>
          }
        />
      </main>
    </div>
  );
}

async function fetchOtherMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string
): Promise<{ id: string; name: string; email: string }[]> {
  let members: { id: string; name: string; email: string }[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email")
      .order("name")
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
