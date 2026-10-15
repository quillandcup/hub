import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { createClient } from "@/lib/supabase/server";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { Tabs } from "@/components/Tabs";
import {
  computeMentorStats,
  computeOverallStats,
  computePeriodStats,
  getMentorships,
  MENTORSHIP_DAYS,
  openLoadByMentor,
  todayKey,
} from "@/lib/mentorship";
import { getVolunteers, rankVolunteers } from "@/lib/big-sister-volunteers";
import { getArrivals } from "@/lib/arrivals";
import EffectivenessPanel from "./EffectivenessPanel";
import MatchesPanel from "./MatchesPanel";
import VolunteersPanel from "./VolunteersPanel";
import { MENTORSHIP_BASE_PATH, MENTORSHIP_TAB_LABELS, MENTORSHIP_TITLE, type MentorshipTab } from "./tabs";

/** Shared by the base page and each tab's route (lib/tab-routes.ts). Callers have already run
 * requireAdminPage(). Behind the `big_sisters` feature preview. */
export default async function MentorshipPage({
  tab,
  prefill,
}: {
  tab: MentorshipTab;
  prefill?: { newMemberId?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await getUserFeaturePreviews(user.id)).includes("big_sisters")) redirect("/admin");

  const supabase = await createClient();
  const today = todayKey(new Date());
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - MENTORSHIP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [rows, volunteers, arrivals] = await Promise.all([
    getMentorships(supabase, today),
    getVolunteers(supabase),
    getArrivals(supabase, since, today),
  ]);
  const ranked = rankVolunteers(volunteers, rows);
  const matched = new Set(rows.filter((r) => r.status === "matched").map((r) => `${r.newMemberId}:${r.startedOn}`));
  const waiting = arrivals.filter((a) => !matched.has(`${a.memberId}:${a.arrivedOn}`));

  const load = openLoadByMentor(rows);

  const prefillId = prefill?.newMemberId;
  const { data: prefillMember } =
    prefillId && /^[0-9a-f-]{36}$/i.test(prefillId)
      ? await supabase.from("members").select("id, name, email").eq("id", prefillId).maybeSingle()
      : { data: null };

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <Link href="/admin" className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold mt-1">{MENTORSHIP_TITLE}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Every new member (a trial, a direct sign-up, someone rejoining, or someone joining through a program that
            includes membership) is matched with a big sister for 30 days. Whether a trial converted comes from
            their membership history.
          </p>
          <div className="absolute top-4 right-6">
            <RecordHistoryButton entityType="mentorship" label="Big Sister matches" />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs
          basePath={MENTORSHIP_BASE_PATH}
          initialTab={tab}
          key={tab}
          pageTitle={{ section: MENTORSHIP_TITLE }}
          tabs={[
            {
              id: "matches",
              label: MENTORSHIP_TAB_LABELS.matches,
              content: (
                <MatchesPanel
                  rows={rows}
                  openLoad={Object.fromEntries(load)}
                  volunteers={ranked}
                  waiting={waiting}
                  prefill={prefillMember ? { newMember: prefillMember } : undefined}
                />
              ),
            },
            {
              id: "volunteers",
              label: `${MENTORSHIP_TAB_LABELS.volunteers} (${ranked.length})`,
              title: MENTORSHIP_TAB_LABELS.volunteers,
              content: <VolunteersPanel volunteers={ranked} />,
            },
            {
              id: "big-sisters",
              label: MENTORSHIP_TAB_LABELS["big-sisters"],
              content: (
                <EffectivenessPanel
                  overall={computeOverallStats(rows)}
                  periods={computePeriodStats(rows)}
                  mentors={computeMentorStats(rows)}
                />
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
