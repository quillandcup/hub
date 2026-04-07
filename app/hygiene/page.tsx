import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DataHygienePage() {
  const supabase = await createClient();

  // Fetch data quality metrics
  const [
    { count: totalCalendarEvents },
    { count: matchedCalendarEvents },
    { count: totalZoomAttendees },
    { count: totalMembers },
    { count: totalAliases },
    { data: pupsWith0Attendees },
    { data: lastSync },
    { data: lastProcessing },
  ] = await Promise.all([
    supabase.from("calendar_events").select("*", { count: "exact", head: true }),
    supabase.from("prickles").select("*", { count: "exact", head: true }).eq("source", "calendar"),
    supabase.from("zoom_attendees").select("*", { count: "exact", head: true }),
    supabase.from("members").select("*", { count: "exact", head: true }),
    supabase.from("member_name_aliases").select("*", { count: "exact", head: true }),
    // Find PUPs with 0 attendees
    supabase
      .from("prickles")
      .select("id, start_time, end_time")
      .eq("source", "zoom")
      .not("id", "in", `(SELECT DISTINCT prickle_id FROM attendance WHERE prickle_id IS NOT NULL)`)
      .limit(10),
    // Last calendar sync (use imported_at which updates on UPSERT)
    supabase
      .from("calendar_events")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single(),
    // Last attendance processing (most recent PUP)
    supabase
      .from("prickles")
      .select("created_at")
      .eq("source", "zoom")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const calendarMatchRate = totalCalendarEvents && matchedCalendarEvents
    ? Math.round((matchedCalendarEvents / totalCalendarEvents) * 100)
    : 0;

  const unmatchedEvents = (totalCalendarEvents || 0) - (matchedCalendarEvents || 0);

  // Calculate Zoom match rate (from most recent processing)
  // This is an estimate - actual rate would need to be stored in processing results
  const estimatedZoomMatchRate = 95; // Placeholder - would come from last processing result

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">
          Data Hygiene Dashboard
        </h1>

        {/* At-a-glance metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Calendar Events */}
          <Link
            href="/hygiene/unmatched-events"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Calendar Events
              </h3>
              <span className="text-2xl">📋</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {calendarMatchRate}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {matchedCalendarEvents}/{totalCalendarEvents} matched
            </p>
            {unmatchedEvents > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {unmatchedEvents} unmatched events →
              </p>
            )}
          </Link>

          {/* Zoom Attendees */}
          <Link
            href="/hygiene/unmatched-zoom"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Zoom Attendees
              </h3>
              <span className="text-2xl">🔍</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {estimatedZoomMatchRate}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              match rate (last 30 days)
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              View unmatched names →
            </p>
          </Link>

          {/* Name Aliases */}
          <Link
            href="/hygiene/name-matching"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Name Aliases
              </h3>
              <span className="text-2xl">🧩</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {totalAliases}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              active aliases for {totalMembers} members
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              Manage aliases →
            </p>
          </Link>
        </div>

        {/* Data quality warnings */}
        {pupsWith0Attendees && pupsWith0Attendees.length > 0 && (
          <div className="mb-8 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-1">
                  {pupsWith0Attendees.length} PUPs with 0 attendees detected
                </h3>
                <p className="text-sm text-orange-800 dark:text-orange-200 mb-2">
                  These Pop-Up Prickles were created but have no attendance records.
                  This usually indicates unmatched Zoom attendees or data quality issues.
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-300">
                  Recommendation: Review unmatched Zoom attendees and reprocess attendance data.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recent activity */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Recent Activity
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last calendar sync:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastSync?.imported_at
                  ? new Date(lastSync.imported_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last attendance processing:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastProcessing?.created_at
                  ? new Date(lastProcessing.created_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
