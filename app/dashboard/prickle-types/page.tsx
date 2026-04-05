import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import UnmatchedEventsTable from "./UnmatchedEventsTable";

export default async function PrickleTypesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Prickle Type Management</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Review and categorize calendar events that couldn't be automatically matched
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Unmatched Events Queue */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow mb-8">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xl font-bold">Unmatched Calendar Events ({unmatchedEvents?.length || 0} events, {eventGroups.length} unique)</h2>
          </div>

          <UnmatchedEventsTable eventGroups={eventGroups} prickleTypes={prickleTypes || []} />

          {eventGroups.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No unmatched events! All calendar events have been categorized. 🎉
            </div>
          )}
        </div>

        {/* Prickle Types List */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-xl font-bold">Prickle Types ({prickleTypes?.length || 0})</h2>
            <Link
              href="/dashboard/prickle-types/new"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Add Type
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Normalized
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {prickleTypes?.map((type: any) => (
                  <tr key={type.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {type.name}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-mono">
                        {type.normalized_name}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/dashboard/prickle-types/${type.id}/edit`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
