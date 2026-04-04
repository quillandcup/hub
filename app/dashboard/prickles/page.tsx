import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function PricklesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch prickles with popularity data
  const { data: prickles } = await supabase
    .from("prickles")
    .select(`
      *,
      prickle_popularity(*)
    `)
    .order("start_time", { ascending: false })
    .limit(20);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Prickle Insights</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Prickle
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Host
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Avg Attendance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {prickles?.map((prickle: any) => (
                  <tr key={prickle.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {prickle.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-500 dark:text-slate-400">
                        {prickle.host}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900 dark:text-slate-100">
                        {new Date(prickle.start_time).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(prickle.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TypeBadge type={prickle.type} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                      {prickle.prickle_popularity?.avg_attendance?.toFixed(1) || "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TrendBadge trend={prickle.prickle_popularity?.trend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {prickles?.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No prickles found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;

  const colors = {
    sprint: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    flow: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
    deep_work: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
    focus: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[type as keyof typeof colors] || "bg-slate-100 text-slate-800"}`}>
      {type.replace("_", " ")}
    </span>
  );
}

function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return <span className="text-sm text-slate-400">—</span>;

  const colors = {
    increasing: "text-green-600 dark:text-green-400",
    stable: "text-slate-600 dark:text-slate-400",
    decreasing: "text-red-600 dark:text-red-400",
  };

  const icons = {
    increasing: "↗",
    stable: "→",
    decreasing: "↘",
  };

  return (
    <span className={`text-sm font-medium ${colors[trend as keyof typeof colors]}`}>
      {icons[trend as keyof typeof icons]} {trend}
    </span>
  );
}
