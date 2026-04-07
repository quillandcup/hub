import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import MemberDetails from "./MemberDetails";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch member data with metrics and engagement
  const { data: member } = await supabase
    .from("members")
    .select(`
      *,
      member_metrics(*),
      member_engagement(*)
    `)
    .eq("id", id)
    .single();

  if (!member) {
    notFound();
  }

  // Fetch all attendance records for this member with prickle details
  const { data: attendance } = await supabase
    .from("attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      prickles(
        id,
        host:members(id, name),
        start_time,
        end_time,
        prickle_types(name)
      )
    `)
    .eq("member_id", id)
    .order("join_time", { ascending: false });

  // Fetch member name aliases
  const { data: aliases } = await supabase
    .from("member_name_aliases")
    .select("alias")
    .eq("member_id", id)
    .order("alias");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard/members" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Members
          </Link>
          <div className="mt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{member.name}</h1>
              {aliases && aliases.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {aliases.map(({ alias }) => (
                      <span
                        key={alias}
                        className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs border border-slate-200 dark:border-slate-600"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                  <div className="group relative">
                    <svg
                      className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="invisible group-hover:visible absolute left-0 top-6 w-64 p-2 bg-slate-900 dark:bg-slate-700 text-white text-xs rounded shadow-lg z-10">
                      Aliases help match Zoom names to people. <Link href="/hygiene/unmatched-zoom" className="underline hover:text-blue-300">Manage aliases →</Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {member.email}
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MemberDetails member={member} attendanceRecords={attendance || []} />
      </main>
    </div>
  );
}
