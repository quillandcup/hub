import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import UnmatchedEventsTable from "../prickle-types/UnmatchedEventsTable";

export default async function UnmatchedEventsPage() {
  const supabase = await createClient();

  // Fetch unmatched calendar events
  const { data: unmatchedEvents } = await supabase
    .from("unmatched_calendar_events")
    .select(`
      id,
      calendar_event_id,
      raw_summary,
      suggested_type,
      suggested_host,
      status,
      created_at
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Group by raw_summary
  const groupedEvents = new Map<string, any[]>();
  unmatchedEvents?.forEach((event: any) => {
    const summary = event.raw_summary;
    if (!groupedEvents.has(summary)) {
      groupedEvents.set(summary, []);
    }
    groupedEvents.get(summary)!.push(event);
  });

  // Convert to array for rendering
  const eventGroups = Array.from(groupedEvents.entries()).map(([summary, events]) => ({
    summary,
    count: events.length,
    eventIds: events.map((e: any) => e.id),
    calendarEventIds: events.map((e: any) => e.calendar_event_id),
    suggestedType: events[0].suggested_type,
    suggestedHost: events[0].suggested_host,
  }));

  // Fetch all prickle types
  const { data: prickleTypes } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name")
    .order("name");

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Unmatched Calendar Events</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Categorize calendar events that couldn't be automatically matched to prickle types
        </p>
      </div>

      {/* Unmatched Events Queue */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">
            Pending Events ({unmatchedEvents?.length || 0} events, {eventGroups.length} unique)
          </h2>
        </div>

        <UnmatchedEventsTable eventGroups={eventGroups} prickleTypes={prickleTypes || []} />

        {eventGroups.length === 0 && (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            No unmatched events! All calendar events have been categorized. 🎉
          </div>
        )}
      </div>
    </div>
  );
}
