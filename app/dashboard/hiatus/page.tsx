import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HiatusTrackingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch all members currently on hiatus with their hiatus history
  const { data: onHiatusMembers } = await supabase
    .from("members")
    .select(`
      id,
      name,
      email,
      status,
      member_hiatus_history(*)
    `)
    .eq("status", "on_hiatus")
    .order("name");

  // Fetch members returning soon (hiatus ending in next 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { data: returningSoonMembers } = await supabase
    .from("member_hiatus_history")
    .select(`
      id,
      start_date,
      end_date,
      member:members(id, name, email, status)
    `)
    .not("end_date", "is", null)
    .lte("end_date", thirtyDaysFromNow.toISOString().split("T")[0])
    .gte("end_date", new Date().toISOString().split("T")[0])
    .order("end_date", { ascending: true });

  // Process on-hiatus members with progress calculation
  const hiatusData = (onHiatusMembers || [])
    .map((member: any) => {
      // Find current (ongoing) hiatus
      const currentHiatus = member.member_hiatus_history?.find((h: any) => !h.end_date);

      if (!currentHiatus) return null; // Skip if no current hiatus

      const startDate = new Date(currentHiatus.start_date);
      const now = new Date();
      const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const monthsSinceStart = daysSinceStart / 30;

      // Assume 12-month default hiatus length for progress calculation
      const estimatedLength = 12; // months
      const progressPercent = Math.min((monthsSinceStart / estimatedLength) * 100, 100);

      let progressLabel = "";
      let nextContactDays = 0;

      if (progressPercent < 25) {
        progressLabel = "25%";
        nextContactDays = Math.ceil((estimatedLength * 0.25 * 30) - daysSinceStart);
      } else if (progressPercent < 50) {
        progressLabel = "50%";
        nextContactDays = Math.ceil((estimatedLength * 0.50 * 30) - daysSinceStart);
      } else if (progressPercent < 75) {
        progressLabel = "75%";
        nextContactDays = Math.ceil((estimatedLength * 0.75 * 30) - daysSinceStart);
      } else {
        progressLabel = "90%+";
        nextContactDays = 0; // Contact soon/overdue
      }

      const nextContactDate = new Date(now);
      nextContactDate.setDate(nextContactDate.getDate() + nextContactDays);

      return {
        member,
        currentHiatus,
        startDate,
        daysSinceStart,
        monthsSinceStart,
        progressPercent,
        progressLabel,
        nextContactDate,
        nextContactDays,
      };
    })
    .filter(Boolean) // Remove nulls
    .sort((a, b) => a!.nextContactDate.getTime() - b!.nextContactDate.getTime()); // Sort by next contact date

  // Group by next contact month
  const groupedByMonth = new Map<string, any[]>();

  for (const item of hiatusData) {
    if (!item) continue;
    const monthKey = item.nextContactDate.toLocaleDateString("en-US", { month: "short" });
    if (!groupedByMonth.has(monthKey)) {
      groupedByMonth.set(monthKey, []);
    }
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
              {returningSoonMembers?.length || 0}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Within 30 days</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Next Follow-up</h3>
            <p className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">
              {hiatusData.length > 0
                ? hiatusData[0]!.nextContactDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "None"}
            </p>
            {hiatusData.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                {hiatusData[0]!.member.name}
              </p>
            )}
          </div>
        </div>

        {/* Current Hiatuses - Grouped by Next Contact Month */}
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
                  {items.map((item: any) => (
                    <tr key={item.member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {item.nextContactDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/dashboard/members/${item.member.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          {item.member.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                          Hiatus {item.progressLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {item.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {Math.floor(item.monthsSinceStart)} months
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Returning Soon */}
        {returningSoonMembers && returningSoonMembers.length > 0 && (
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
                  {returningSoonMembers.map((record: any) => (
                    <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <span className="inline-block px-3 py-1 text-sm font-semibold rounded bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100">
                          {new Date(record.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/dashboard/members/${record.member.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          {record.member.name}
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
