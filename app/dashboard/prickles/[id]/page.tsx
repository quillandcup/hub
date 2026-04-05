import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function PrickleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch prickle details with type
  const { data: prickle } = await supabase
    .from("prickles")
    .select(`
      id,
      host,
      start_time,
      end_time,
      source,
      zoom_meeting_uuid,
      prickle_types!inner(name, description)
    `)
    .eq("id", params.id)
    .single();

  if (!prickle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          <Link href="/dashboard/calendar" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Calendar
          </Link>
        </div>
      </div>
    );
  }

  // Fetch attendance records with member details
  const { data: attendanceRecords } = await supabase
    .from("attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      members!inner(id, name, email)
    `)
    .eq("prickle_id", params.id)
    .order("join_time", { ascending: true });

  const prickleType = prickle.prickle_types as any;
  const startTime = new Date(prickle.start_time);
  const endTime = new Date(prickle.end_time);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard/calendar" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Calendar
          </Link>
          <h1 className="text-2xl font-bold mt-2">{prickleType?.name || "Prickle Details"}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Prickle Info */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Session Details</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-600 dark:text-slate-400">Type:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{prickleType?.name || "Unknown"}</p>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Host:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{prickle.host || "None"}</p>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Date:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {startTime.toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Time:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {startTime.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })} - {endTime.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  <span className="text-slate-500 dark:text-slate-400 ml-2">({durationMinutes} min)</span>
                </p>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Source:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {prickle.source === "calendar" ? "Google Calendar" : "Pop-Up Prickle (Zoom)"}
                </p>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Attendance:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {attendanceRecords?.length || 0} {attendanceRecords?.length === 1 ? "attendee" : "attendees"}
                </p>
              </div>
            </div>
            {prickleType?.description && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-600 dark:text-slate-400 text-sm">Description:</span>
                <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{prickleType.description}</p>
              </div>
            )}
          </div>

          {/* Attendance List */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold">Attendees ({attendanceRecords?.length || 0})</h2>
            </div>
            {attendanceRecords && attendanceRecords.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Member
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Join Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Leave Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {attendanceRecords.map((record: any) => {
                      const member = record.members;
                      const joinTime = new Date(record.join_time);
                      const leaveTime = new Date(record.leave_time);
                      const attendDuration = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

                      return (
                        <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {member.name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {member.email}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                            {joinTime.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                            {leaveTime.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                            {attendDuration} min
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                No attendance records for this prickle
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
