import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { computeHiatusTouchpoint } from "@/lib/hiatus-touchpoints";

export const metadata: Metadata = {
  title: "Hiatus Tracking",
};

interface HiatusRow {
  id: string;
  start_date: string;
  end_date: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  status: string;
  member_hiatus_history: HiatusRow[] | null;
}

export default async function HiatusTrackingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes('hiatus_tracking')) redirect("/admin");

  // Fetch all members currently on hiatus, with their hiatus history.
  // member_hiatus_history is the live source of truth for hiatus tracking.
  const { data: onHiatusMembersRaw } = await supabase
    .from("members")
    .select(`
      id,
      name,
      email,
      status,
      member_hiatus_history(id, start_date, end_date)
    `)
    .eq("status", "on_hiatus")
    .order("name");

  const now = new Date();

  const onHiatusMembers = (onHiatusMembersRaw || []) as unknown as MemberRow[];

  // For each on-hiatus member, find their currently-active hiatus period
  // (start_date in the past, end_date null or still in the future).
  const hiatusData = onHiatusMembers
    .map((member) => {
      const currentHiatus = (member.member_hiatus_history || [])
        .filter((h) => new Date(h.start_date) <= now && (!h.end_date || new Date(h.end_date) >= now))
        .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())[0];

      if (!currentHiatus) return null;

      const touchpoint = computeHiatusTouchpoint(currentHiatus.start_date, currentHiatus.end_date, now);
      const startDate = new Date(currentHiatus.start_date);
      const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      return { member, hiatus: currentHiatus, touchpoint, startDate, daysSinceStart };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Upcoming touchpoints — hiatuses with a known end date and a touchpoint
  // still ahead, sorted chronologically by that date. Mirrors the "Next
  // Month" tracking sheet this page replaces.
  const upcomingTouchpoints = hiatusData
    .filter((item) => item.touchpoint.nextTouchpoint !== null)
    .sort(
      (a, b) =>
        new Date(a.touchpoint.nextTouchpoint!.date).getTime() -
        new Date(b.touchpoint.nextTouchpoint!.date).getTime()
    );

  // Returning soon — past the 75% mark of a known-duration hiatus, sorted
  // by expected end date. Indefinite hiatuses (no end_date) never appear
  // here — there's no date to sort by.
  const returningSoon = hiatusData
    .filter((item) => item.touchpoint.isPastAllTouchpoints && item.hiatus.end_date)
    .sort((a, b) => new Date(a.hiatus.end_date!).getTime() - new Date(b.hiatus.end_date!).getTime());

  // Group upcoming touchpoints by month for display, same as before.
  const groupedByMonth = new Map<string, typeof upcomingTouchpoints>();
  for (const item of upcomingTouchpoints) {
    const monthKey = new Date(item.touchpoint.nextTouchpoint!.date).toLocaleDateString("en-US", { month: "short" });
    if (!groupedByMonth.has(monthKey)) groupedByMonth.set(monthKey, []);
    groupedByMonth.get(monthKey)!.push(item);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Hiatus Tracking</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Members currently on hiatus and scheduled follow-ups
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Currently on Hiatus</h3>
            <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
              {hiatusData.length}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Returning Soon</h3>
            <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
              {returningSoon.length}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Beyond 75%</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Next Touchpoint</h3>
            <p className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">
              {upcomingTouchpoints.length > 0
                ? new Date(upcomingTouchpoints[0].touchpoint.nextTouchpoint!.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : "None"}
            </p>
            {upcomingTouchpoints.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                {upcomingTouchpoints[0].member.name}
              </p>
            )}
          </div>
        </div>

        {/* Upcoming Touchpoints - Grouped by Month */}
        {Array.from(groupedByMonth.entries()).map(([month, items]) => (
          <div key={month} className="bg-white dark:bg-slate-900 rounded-lg shadow">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold">{month}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Next Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Hedgie
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Hiatus Event
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Started
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Duration
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {items.map((item) => (
                    <tr key={item.member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {new Date(item.touchpoint.nextTouchpoint!.date).toLocaleDateString("en-US", {
                          month: "numeric",
                          day: "numeric",
                          year: "2-digit",
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/members/${item.member.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          {item.member.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                          Hiatus {item.touchpoint.nextTouchpoint!.pct}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {item.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {Math.floor(item.daysSinceStart / 30)} months
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Returning Soon */}
        {returningSoon.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold">Returning Soon - Beyond 75%</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Hiatus End
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Hedgie
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {returningSoon.map((item) => (
                    <tr key={item.hiatus.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <span className="inline-block px-3 py-1 text-sm font-semibold rounded bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100">
                          {new Date(item.hiatus.end_date!).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/members/${item.member.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          {item.member.name}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hiatusData.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">No members currently on hiatus</p>
          </div>
        )}
      </main>
    </div>
  );
}
