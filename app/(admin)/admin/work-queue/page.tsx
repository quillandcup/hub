import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import {
  buildWelcomeBackQueue,
  buildHedgieversaryQueue,
  buildHiatusNudgeQueue,
  completionKey,
  type HiatusInput,
  type MemberInput,
} from "@/lib/admin-work-queue";
import type { HiatusWindow } from "@/lib/member-tenure";
import WorkQueueSections from "./WorkQueueSections";
import type { SupabaseClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Work Queue",
};

// Same pagination pattern as app/api/process/members/route.ts and
// admin/hedgieversaries/page.tsx — these tables can each grow past
// Supabase's 1000-row cap.
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

export default async function WorkQueuePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("work_queue")) redirect("/admin");

  // Only current members (active or on_hiatus) — a fully cancelled member
  // isn't due a Hedgieversary celebration or a welcome-back action.
  const [members, hiatusHistory, completions] = await Promise.all([
    fetchAllRows(
      supabase,
      "members",
      "id, name, first_joined_at",
      (q) => q.in("status", ["active", "on_hiatus"])
    ),
    fetchAllRows(supabase, "member_hiatus_history", "id, member_id, start_date, end_date"),
    fetchAllRows(supabase, "admin_work_queue_completions", "queue_type, member_id, occurrence_key"),
  ]);

  const now = new Date();

  const memberInputs: MemberInput[] = members;
  const membersById = new Map(members.map((m) => [m.id, { name: m.name }]));
  const hiatusInputs: HiatusInput[] = hiatusHistory;

  const hiatusWindowsByMember = new Map<string, HiatusWindow[]>();
  for (const hiatus of hiatusHistory) {
    const windows = hiatusWindowsByMember.get(hiatus.member_id) ?? [];
    windows.push({ startsAt: hiatus.start_date, endsAt: hiatus.end_date });
    hiatusWindowsByMember.set(hiatus.member_id, windows);
  }

  const completed = new Set(
    completions.map((c) => completionKey(c.queue_type, c.member_id, c.occurrence_key))
  );

  const welcomeBackQueue = buildWelcomeBackQueue(hiatusInputs, membersById, completed, now);
  const hedgieversaryQueue = buildHedgieversaryQueue(memberInputs, hiatusWindowsByMember, completed, now);
  const hiatusNudgeQueue = buildHiatusNudgeQueue(hiatusInputs, membersById, completed, now);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Work Queue</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Welcome-back, Hedgieversary celebration, and hiatus-nudge tasks, sorted by deadline.
            Mark each one done as you handle it.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <WorkQueueSections
          welcomeBackQueue={welcomeBackQueue}
          hedgieversaryQueue={hedgieversaryQueue}
          hiatusNudgeQueue={hiatusNudgeQueue}
        />
      </main>
    </div>
  );
}
