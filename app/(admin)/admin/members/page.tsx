import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MemberFilters from "./MemberFilters";
import MembersTable from "./MembersTable";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get filter from URL
  const filter = (params.filter as string) || "active";
  const search = (params.search as string) || "";

  // Build query - apply filters that work on the members table directly
  let query = supabase
    .from("members")
    .select(`
      *,
      member_metrics(*),
      member_engagement(*)
    `);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  // Apply status filters (these work on the members table directly)
  if (filter === "active") {
    query = query.eq("status", "active");
  } else if (filter === "on_hiatus") {
    query = query.eq("status", "on_hiatus");
  } else if (filter === "unregistered") {
    query = query.eq("status", "active").is("user_id", null);
  }

  const { data: allMembers } = await query.order("name");

  // Apply engagement filters in memory (these require filtering on joined data)
  let members = allMembers ?? null;
  if (filter === "at_risk") {
    members = allMembers?.filter((m) => m.member_engagement?.risk_level === "high") ?? null;
  } else if (filter === "highly_engaged") {
    members = allMembers?.filter((m) => m.member_engagement?.engagement_tier === "highly_engaged") ?? null;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Member Analytics</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          {/* Filters */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <MemberFilters currentFilter={filter} />
          </div>

          {/* Table */}
          <MembersTable members={members ?? []} />

          {members?.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No members found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

