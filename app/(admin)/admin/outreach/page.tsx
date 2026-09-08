import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import OutreachTable, { type OutreachLead } from "./OutreachTable";
import type { SupabaseClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Outreach",
};

const IDEAL_HEDGIE_TAG = "Ideal Hedgie";

// Same pagination pattern as app/api/process/members/route.ts — members can
// exceed Supabase's 1000-row cap, even though the Ideal Hedgie-tagged subset
// filtered below normally won't.
async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  filter?: (query: any) => any
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(columns);
    if (filter) query = filter(query);
    const { data: batch, error } = await query.range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

export default async function OutreachPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [leads, statuses] = await Promise.all([
    fetchAllRows(
      supabase,
      "members",
      "id, name, email, photo_url, instagram_url, status",
      (q) => q.contains("kajabi_tags", [IDEAL_HEDGIE_TAG]).order("name")
    ),
    fetchAllRows(supabase, "outreach_leads", "member_id, status, updated_at"),
  ]);

  const statusByMemberId = new Map(statuses.map((s) => [s.member_id, s]));

  const rows: OutreachLead[] = leads.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    photoUrl: m.photo_url,
    instagramUrl: m.instagram_url,
    memberStatus: m.status,
    outreachStatus: statusByMemberId.get(m.id)?.status ?? "cold",
    outreachUpdatedAt: statusByMemberId.get(m.id)?.updated_at ?? null,
  }));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">🎯 Outreach</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Leads tagged &ldquo;{IDEAL_HEDGIE_TAG}&rdquo;. Mark hot when you have a call to action to
            schedule a trial prickle.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{rows.length}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">ideal hedgie leads</div>
          </div>

          {rows.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              No leads tagged &ldquo;{IDEAL_HEDGIE_TAG}&rdquo; yet.
            </div>
          ) : (
            <OutreachTable leads={rows} />
          )}
        </div>
      </main>
    </div>
  );
}
