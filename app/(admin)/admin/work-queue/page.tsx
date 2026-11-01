import type { Metadata } from "next";
import { getMemberDisplayName } from "@/lib/member-display-name";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import {
  buildWelcomeBackQueue,
  buildHedgieversaryQueue,
  buildHiatusNudgeQueue,
  buildBigSisterQueue,
  bigSisterMatchKey,
  completionKey,
  type WorkQueueType,
  type HiatusInput,
  type MemberInput,
  type CompletionLookup,
  type CompletionStatus,
  WORK_QUEUE_LOOKBACK_DAYS,
} from "@/lib/admin-work-queue";
import type { HiatusWindow } from "@/lib/member-tenure";
import { getArrivals } from "@/lib/arrivals";
import WorkQueueSections from "./WorkQueueSections";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Work Queue",
};

export default async function WorkQueuePage() {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("work_queue")) redirect("/admin");

  // Only current members (active or on_hiatus) — a fully cancelled member
  // isn't due a Hedgieversary celebration or a welcome-back action.
  const now = new Date();
  const sinceDate = new Date(now.getTime() - WORK_QUEUE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  // The Big Sister section is its own preview: skip its queries when it's off.
  const bigSistersOn = enabledFeatures.includes("big_sisters");
  const repos = createRepos(supabase);
  const [members, hiatusHistory, completions, newMembers, matches] = await Promise.all([
    repos.members.tenureOf(["active", "on_hiatus"]),
    repos.memberStatus.allHiatuses(),
    repos.adminWork.completions(),
    bigSistersOn ? getArrivals(createRepos(supabase), sinceDate, now.toISOString().slice(0, 10)) : Promise.resolve([]),
    bigSistersOn ? repos.mentorship.matchedArrivals() : Promise.resolve([]),
  ]);

  // The queue shows each member by the name the community knows them by.
  const memberInputs: MemberInput[] = members.map((m) => ({
    id: m.id,
    name: getMemberDisplayName({ name: m.name, display_name: m.displayName }),
    first_joined_at: m.firstJoinedAt,
    total_active_months: m.totalActiveMonths,
  }));
  const membersById = new Map(memberInputs.map((m) => [m.id, { name: m.name }]));
  const hiatusInputs: HiatusInput[] = hiatusHistory;

  const hiatusWindowsByMember = new Map<string, HiatusWindow[]>();
  for (const hiatus of hiatusHistory) {
    const windows = hiatusWindowsByMember.get(hiatus.member_id) ?? [];
    windows.push({ startsAt: hiatus.start_date, endsAt: hiatus.end_date });
    hiatusWindowsByMember.set(hiatus.member_id, windows);
  }

  const completed: CompletionLookup = new Map(
    completions.map((c) => [
      completionKey(c.queue_type as WorkQueueType, c.member_id, c.occurrence_key),
      { status: c.status as CompletionStatus, postponedUntil: c.postponed_until },
    ])
  );

  const welcomeBackQueue = buildWelcomeBackQueue(hiatusInputs, membersById, completed, now);
  const hedgieversaryQueue = buildHedgieversaryQueue(memberInputs, hiatusWindowsByMember, completed, now);
  const hiatusNudgeQueue = buildHiatusNudgeQueue(hiatusInputs, membersById, completed, now);
  const bigSisterQueue = buildBigSisterQueue(
    newMembers.map((a) => ({ memberId: a.memberId, memberName: a.memberName, startedOn: a.arrivedOn })),
    new Set(matches.map((m) => bigSisterMatchKey(m.new_member_id, m.started_on))),
    completed,
    now
  );

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <div className="absolute top-4 right-6">
            <RecordHistoryButton entityType="work_queue_completion" label="work queue completions" />
          </div>
          <h1 className="text-2xl font-bold">Work Queue</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Big sister matches, welcome-backs, Hedgieversary celebrations, and hiatus nudges, sorted by deadline.
            Mark each one done as you handle it.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <WorkQueueSections
          welcomeBackQueue={welcomeBackQueue}
          hedgieversaryQueue={hedgieversaryQueue}
          hiatusNudgeQueue={hiatusNudgeQueue}
          bigSisterQueue={bigSisterQueue}
        />
      </main>
    </div>
  );
}
