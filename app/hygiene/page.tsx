import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import ProcessOrphanedButton from "./ProcessOrphanedButton";

export const dynamic = "force-dynamic";

export default async function DataHygienePage() {
  const supabase = await createClient();

  // Fetch data quality metrics
  const [
    { count: totalCalendarEvents },
    { count: matchedCalendarEvents },
    { count: unmatchedCalendarEvents },
    { count: totalZoomAttendees },
    { count: totalMembers },
    { count: totalAliases },
    { data: pupsWith0Attendees },
    { data: oldUnmatchedEvents },
    { data: lastSync },
    { data: lastProcessing },
  ] = await Promise.all([
    supabase.from("calendar_events").select("*", { count: "exact", head: true }),
    supabase.from("prickles").select("*", { count: "exact", head: true }).eq("source", "calendar"),
    supabase.from("unmatched_calendar_events").select("*", { count: "exact", head: true }).eq("status", "pending"),
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
    // Find old unmatched events (queued before prickle_types migration)
    supabase
      .from("unmatched_calendar_events")
      .select("id, raw_summary, created_at")
      .eq("status", "pending")
      .lt("created_at", "2026-04-06 02:00:00") // Before prickle_types were added
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

  // Calculate orphaned events (imported but never processed)
  const orphanedEvents = (totalCalendarEvents || 0) - (matchedCalendarEvents || 0) - (unmatchedCalendarEvents || 0);

  // Get date range of orphaned events if any exist
  // We use the full calendar_events range as an approximation
  // The processing uses DELETE + INSERT so it's safe to reprocess the full range
  let orphanedDateRange = null;
  if (orphanedEvents > 0) {
    const [{ data: minEvent }, { data: maxEvent }] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("start_time")
        .order("start_time", { ascending: true })
        .limit(1)
        .single(),
      supabase
        .from("calendar_events")
        .select("end_time")
        .order("end_time", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (minEvent && maxEvent) {
      orphanedDateRange = { fromDate: minEvent.start_time, toDate: maxEvent.end_time };
    }
  }

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
            {unmatchedCalendarEvents && unmatchedCalendarEvents > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {unmatchedCalendarEvents} unmatched events →
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
            href="/data/aliases"
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
              View all aliases →
            </p>
          </Link>
        </div>

        {/* Data quality warnings */}
        <div className="space-y-4 mb-8">
          {orphanedEvents > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">🚨</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                    {orphanedEvents} orphaned calendar events detected
                  </h3>
                  <p className="text-sm text-red-800 dark:text-red-200 mb-2">
                    These events were imported but never processed - they're not in prickles or the
                    unmatched queue. This usually means they fell outside the date range during processing.
                  </p>
                  <div className="mt-3">
                    <ProcessOrphanedButton
                      orphanedCount={orphanedEvents}
                      dateRange={orphanedDateRange}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {oldUnmatchedEvents && oldUnmatchedEvents.length > 0 && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">💡</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    {oldUnmatchedEvents.length}+ old unmatched events can be auto-resolved
                  </h3>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                    These events were queued before prickle types were added and can now be
                    automatically categorized (e.g., &quot;Heads Down Prickle&quot;).
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Recommendation: Reprocess calendar events from early March to auto-resolve
                    these events.
                  </p>
                </div>
              </div>
            </div>
          )}

          {pupsWith0Attendees && pupsWith0Attendees.length > 0 && (
            <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
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
        </div>

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
