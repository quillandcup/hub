import type { Metadata } from "next";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import { isAtRisk, summarizeAttendance } from "@/lib/domain/attendance";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { formatDateOnly } from "@/lib/formatters";

export const metadata: Metadata = {
  title: "At-Risk Members",
};

export default async function AtRiskPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // Get all active members with their attendance. Leads, cancelled, and
  // on-hiatus members are excluded — a hiatus member isn't expected to
  // attend, so including them only inflates the at-risk count.
  const repos = createRepos(supabase);
  const [activeMembers, attendance] = await Promise.all([
    repos.members.list({ status: "active", orderBy: "name" }),
    repos.attendance.list(),
  ]);
  const summaries = summarizeAttendance(attendance);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Staff-only accounts are excluded; staff who also pay keep source='kajabi' and stay eligible.
  const atRiskMembers = activeMembers.filter((m) => isAtRisk(m, summaries.get(m.id), thirtyDaysAgo));

  const membersWithStats = atRiskMembers.map((m) => {
    const summary = summaries.get(m.id);
    const lastAttendance = summary?.lastJoin ?? null;
    return {
      ...m,
      totalAttendance: summary?.count ?? 0,
      lastAttendance,
      daysSinceLastAttendance: lastAttendance
        ? Math.floor((clock.now() - lastAttendance.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  });

  // Sort by days since last attendance (descending), then by name
  membersWithStats.sort((a, b) => {
    if (a.daysSinceLastAttendance === null && b.daysSinceLastAttendance === null) {
      return a.name.localeCompare(b.name);
    }
    if (a.daysSinceLastAttendance === null) return -1;
    if (b.daysSinceLastAttendance === null) return 1;
    return b.daysSinceLastAttendance - a.daysSinceLastAttendance;
  });

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-plum-600 dark:text-plum-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">⚠️ At-Risk Members</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Active members with no attendance in the last 30 days
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {atRiskMembers.length}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  members need outreach
                </div>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {membersWithStats.length === 0 ? (
              <div className="p-12 text-center text-slate-600 dark:text-slate-400">
                No at-risk members! 🎉
              </div>
            ) : (
              membersWithStats.map((member) => (
                <div key={member.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="font-semibold text-lg text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400 transition-colors"
                      >
                        {member.name}
                      </Link>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {member.email}
                      </div>
                      <div className="flex gap-4 mt-3 text-sm">
                        <div>
                          <span className="text-slate-600 dark:text-slate-400">Total attendance:</span>{" "}
                          <span className="font-semibold">{member.totalAttendance}</span>
                        </div>
                        <div>
                          <span className="text-slate-600 dark:text-slate-400">Joined:</span>{" "}
                          <span className="font-semibold">
                            {formatDateOnly(member.joinedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      {member.daysSinceLastAttendance === null ? (
                        <div className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm font-semibold">
                          Never attended
                        </div>
                      ) : (
                        <div className="text-slate-900 dark:text-slate-100">
                          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {member.daysSinceLastAttendance}
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">
                            days ago
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
