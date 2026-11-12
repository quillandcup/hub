import Link from "next/link";
import { Tabs } from "@/components/Tabs";
import type { StaffUser } from "@/lib/admin-auth";
import { clock } from "@/lib/clock";
import { careStatus, isActiveStatus, sortActive, sortEarlier } from "@/lib/care";
import { loadCareDmTab, ownSlackIdentity, projectCareFromDms, type CareDmTab } from "@/lib/care-dm";
import { resolveDmLinks, slackTeamId, type DmLink } from "@/lib/care-dm-link";
import { membersWhoseNewCareFollowsDm } from "@/lib/care-dm-rules";
import { loadCareScores } from "@/lib/care-scores";
import { loadCareOwners } from "@/lib/care-owners";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { orgYmd } from "@/lib/org-week";
import { staffCan } from "@/lib/staff-access";
import { createClient } from "@/lib/supabase/server";
import { careAttention } from "./attention";
import CareAttention from "./CareAttention";
import { toEngagementCard } from "./card";
import { ActiveList, EarlierList } from "./CareLists";
import CareDmList from "./CareDmList";
import StartEngagementForm from "./StartEngagementForm";
import { CARE_TAB_LABELS, CARE_TITLE, type CareTabId } from "./tabs";

/**
 * Hedgie Care, rendered by /admin/care (Active) and /admin/care/earlier with that tab open. Both tabs' data loads here, so
 * switching is instant. The route pages call requireStaffPage() and pass the user in.
 */
export default async function CarePage({ tab, staff }: { tab: CareTabId; staff: StaffUser }) {
  const now = new Date(clock.now());
  const repos = createRepos(await createClient());
  const service = getServiceRepos();
  const canWrite = staffCan(staff.role, "care.write");
  // Her tracked Slack DMs first (docs/HEDGIE_CARE.md): they fill in who spoke last on her Slack DM engagements, and the
  // list below reads the result. Only her own tracked DMs are looked at, and only when she has some; a failure is logged
  // and the page still opens with what it has.
  const tracked = await repos.careDms.forUser(staff.id).catch((error) => {
    console.error("[care] reading tracked DMs failed:", error instanceof Error ? error.message : error);
    return [];
  });
  if (canWrite && tracked.length > 0) {
    await projectCareFromDms({ care: repos.care, careDms: repos.careDms, service }, { userId: staff.id }).catch((error) =>
      console.error("[care] filling in from tracked DMs failed:", error instanceof Error ? error.message : error)
    );
  }
  // Who may own one: user_profiles is read with the service role (a community manager's own client can't read other
  // users' profiles); only ids, names and roles are used.
  const [rows, owners] = await Promise.all([repos.care.list({ includeClosed: true }), loadCareOwners(repos, service)]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  // The member's score then and now, and their last own activity in the community: each one batched read for every row
  // on the page, with her own client (RLS lets staff read the activity log). A failure is logged and the rows show without.
  const [scores, participation] = await Promise.all([
    loadCareScores(repos.activities, rows, now).catch((error) => {
      console.error("[care] working out scores failed:", error instanceof Error ? error.message : error);
      return undefined;
    }),
    repos.activities.lastParticipation([...new Set(rows.map((row) => row.member_id))], now).catch((error) => {
      console.error("[care] reading last participation failed:", error instanceof Error ? error.message : error);
      return undefined;
    }),
  ]);
  // "Open the DM" for the Slack DMs she tracks: Hub Chat when she can open it there, else Slack.
  const dmLinks =
    tracked.length > 0
      ? await ownSlackIdentity(service, staff)
          .then((own) => resolveDmLinks({ chat: service.chat, selfMemberId: own.memberId, slackTeamId: slackTeamId() }, tracked.map((dm) => dm.channelId)))
          .catch((error) => {
            console.error("[care] resolving DM links failed:", error instanceof Error ? error.message : error);
            return new Map<string, DmLink>();
          })
      : new Map<string, DmLink>();
  const options = {
    owners,
    byId,
    scores,
    participation,
    slackTracked: { userId: staff.id, memberIds: new Set(tracked.map((dm) => dm.memberId)), links: new Map(tracked.flatMap((dm) => (dmLinks.has(dm.channelId) ? [[dm.memberId, dmLinks.get(dm.channelId)!] as const] : []))) },
  };
  const active = sortActive(
    rows.filter((row) => isActiveStatus(careStatus(row, now))),
    now
  ).map((row) => toEngagementCard(row, now, options));
  const earlier = sortEarlier(rows.filter((row) => !isActiveStatus(careStatus(row, now)))).map((row) => toEngagementCard(row, now, options));
  const attention = careAttention([...active, ...earlier]);
  // The DM list reads Slack's Bronze for every DM she has: only built when its tab is the one asked for.
  const dmTab: CareDmTab | null =
    tab === "dms"
      ? await loadCareDmTab(service, staff, {
          bridgeOn: (await getUserFeaturePreviews(staff.id)).includes("slack_dm_bridge"),
          trackedChannelIds: new Set(tracked.map((dm) => dm.channelId)),
          now,
          slackTeamId: slackTeamId(),
        })
      : null;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="mb-2 inline-block text-plum-600 hover:underline dark:text-plum-400">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">{CARE_TITLE}</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Members you are reaching out to, one care plan for each stretch of time, and where each one stands.
          </p>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8">
        <CareAttention attention={attention} />
        <Tabs
          key={tab}
          initialTab={tab}
          basePath="/admin/care"
          pageTitle={{ section: CARE_TITLE }}
          tabs={[
            {
              id: "active",
              label: `${CARE_TAB_LABELS.active} (${active.length})`,
              title: CARE_TAB_LABELS.active,
              content: (
                <div className="space-y-6">
                  {canWrite && <StartEngagementForm today={orgYmd(now)} slackDmMemberIds={[...membersWhoseNewCareFollowsDm(staff.id, new Set(tracked.map((dm) => dm.memberId)), rows)]} />}
                  <ActiveList cards={active} canWrite={canWrite} owners={owners} meId={staff.id} />
                </div>
              ),
            },
            {
              id: "earlier",
              label: attention.lapsed > 0 ? `${CARE_TAB_LABELS.earlier} (${attention.lapsed} lapsed)` : CARE_TAB_LABELS.earlier,
              title: CARE_TAB_LABELS.earlier,
              content: <EarlierList cards={earlier} canWrite={canWrite} owners={owners} meId={staff.id} />,
            },
            {
              id: "dms",
              label: CARE_TAB_LABELS.dms,
              title: CARE_TAB_LABELS.dms,
              content: <CareDmList data={dmTab} canWrite={canWrite} />,
            },
          ]}
        />
      </main>
    </div>
  );
}
