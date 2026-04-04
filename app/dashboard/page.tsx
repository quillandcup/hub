import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "./SignOutButton";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch dashboard metrics
  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("status", "active");

  const { data: metrics } = await supabase
    .from("member_metrics")
    .select("*");

  const activeMembers = members?.length || 0;
  const attendedLast7Days = metrics?.filter(m => m.prickles_last_7_days > 0).length || 0;
  const attendedLast30Days = metrics?.filter(m => m.prickles_last_30_days > 0).length || 0;
  const atRisk = metrics?.filter(m => m.prickles_last_30_days === 0).length || 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill & Cup Admin
          </h1>
          <SignOutButton />
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <MetricCard
            label="Active Members"
            value={activeMembers}
            description="Total active"
          />
          <MetricCard
            label="Attended Last 7 Days"
            value={attendedLast7Days}
            description="Recent engagement"
          />
          <MetricCard
            label="Attended Last 30 Days"
            value={attendedLast30Days}
            description="Monthly active"
          />
          <MetricCard
            label="At Risk"
            value={atRisk}
            description="Need outreach"
            highlighted
          />
        </div>

        {/* Hedgie Welcome */}
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-6 mb-8 flex items-center gap-6">
          <img
            src="/hedgie-admin.png"
            alt="Hedgie Administrator"
            className="w-32 h-32 rounded-lg shadow-lg"
          />
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome to Hedgie HQ! 🦔</h2>
            <p className="text-slate-600 dark:text-slate-300">
              Your command center for tracking Prickles attendance, member engagement, and community insights.
            </p>
          </div>
        </div>

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href="/dashboard/members">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Member Analytics</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                View member engagement, risk levels, and activity history
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Members</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/prickles">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Prickle Insights</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Analyze Prickle popularity, trends, and attendance patterns
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Prickles</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, description, highlighted }: { label: string; value: number; description: string; highlighted?: boolean }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg shadow p-6 ${highlighted ? 'ring-2 ring-red-500' : ''}`}>
      <div className={`text-4xl font-bold mb-2 ${highlighted ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
        {value}
      </div>
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{label}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{description}</div>
    </div>
  );
}
