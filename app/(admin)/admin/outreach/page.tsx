import type { Metadata } from "next";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { clock } from "@/lib/clock";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import OutreachTable, { type OutreachLead, type LeadStatus } from "./OutreachTable";
import { createRepos } from "@/lib/data/repos";
import { etDate } from "@/lib/community-stats";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Outreach",
};

const IDEAL_HEDGIE_TAG = "Ideal Hedgie";
// Never show current members here — they're already Hedgies. 'lead' (never
// joined) and 'cancelled' (former member) are the only statuses worth
// outreach; 'cancelled' rows are hidden by default client-side, toggleable
// via OutreachTable's "Include former members" filter.
const OUTREACH_STATUSES = ["lead", "cancelled"];

export default async function OutreachPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const repos = createRepos(supabase);
  const [leads, statuses] = await Promise.all([
    repos.members.withKajabiTag(IDEAL_HEDGIE_TAG, OUTREACH_STATUSES),
    repos.outreach.leadStatuses(),
  ]);

  const memberIds = leads.map((m) => m.id);

  const lastTouchByMemberId = await repos.outreach.lastTouchByMember(memberIds);

  // "Today" totals are computed over a 48h window (not filtered to these
  // members) rather than a precise ET-midnight query boundary, then bucketed
  // by etDate — cheap, DST-safe, and avoids reconstructing a UTC day
  // boundary from an ET wall-clock date.
  const recentTouches = await repos.outreach.touchTimesSince(new Date(clock.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  const todayET = etDate(new Date().toISOString());
  const todayTouchCount = recentTouches.filter((touchedAt) => etDate(touchedAt) === todayET).length;

  const statusByMemberId = new Map(statuses.map((s) => [s.member_id, s]));

  const rows: OutreachLead[] = leads.map((m) => ({
    id: m.id,
    name: getMemberDisplayName({ name: m.name, display_name: m.displayName }),
    legalName: m.name,
    email: m.email,
    photoUrl: m.photoUrl,
    instagramUrl: m.instagramUrl,
    memberStatus: m.status,
    outreachStatus: (statusByMemberId.get(m.id)?.status ?? "cold") as LeadStatus,
    outreachUpdatedAt: statusByMemberId.get(m.id)?.updated_at ?? null,
    lastTouchedAt: lastTouchByMemberId.get(m.id) ?? null,
  }));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <div className="absolute top-4 right-6">
            <RecordHistoryButton entityType="outreach_lead" label="outreach leads" />
          </div>
          <Link href="/admin" className="text-plum-600 dark:text-plum-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">🎯 Outreach</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Leads tagged &ldquo;{IDEAL_HEDGIE_TAG}&rdquo;. Mark hot when you have a call to action to
            schedule a trial prickle.
          </p>
          <Link href="/admin/outreach/prospects" className="text-plum-600 dark:text-plum-400 hover:underline mt-2 inline-block text-sm">
            Find new prospects →
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              {rows.filter((r) => r.memberStatus === "lead").length}
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400">ideal hedgie leads</div>
          </div>

          {rows.length === 0 ? (
            <div className="p-12 text-center text-slate-600 dark:text-slate-400">
              No leads tagged &ldquo;{IDEAL_HEDGIE_TAG}&rdquo; yet.
            </div>
          ) : (
            <OutreachTable leads={rows} initialTodayCount={todayTouchCount} />
          )}
        </div>
      </main>
    </div>
  );
}
