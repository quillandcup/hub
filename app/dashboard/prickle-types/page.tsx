import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

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
      raw_summary,
      suggested_type,
      suggested_host,
      status,
      created_at,
      calendar_events!inner(start_time, end_time)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

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
            <h2 className="text-xl font-bold">Unmatched Calendar Events ({unmatchedEvents?.length || 0})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Event Summary
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Suggested Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Suggested Host
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {unmatchedEvents?.map((event: any) => (
                  <tr key={event.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {event.raw_summary}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900 dark:text-slate-100">
                        {new Date(event.calendar_events.start_time).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(event.calendar_events.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        {event.suggested_type || "—"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        {event.suggested_host || "—"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <form action="/api/prickle-types/resolve" method="POST">
                          <input type="hidden" name="eventId" value={event.id} />
                          <button
                            type="submit"
                            className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          >
                            Review
                          </button>
                        </form>
                        <form action="/api/prickle-types/ignore" method="POST">
                          <input type="hidden" name="eventId" value={event.id} />
                          <button
                            type="submit"
                            className="text-xs px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded transition-colors"
                          >
                            Ignore
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unmatchedEvents?.length === 0 && (
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
