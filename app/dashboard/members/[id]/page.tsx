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
            <h1 className="text-2xl font-bold">{member.name}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {member.email}
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MemberDetails member={member} attendanceRecords={attendance || []} aliases={aliases || []} />
      </main>
    </div>
  );
}
