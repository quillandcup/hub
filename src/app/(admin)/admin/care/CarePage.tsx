import Link from "next/link";
import { Tabs } from "@/components/Tabs";
import type { StaffUser } from "@/lib/admin-auth";
import { clock } from "@/lib/clock";
import { careStatus, isActiveStatus, sortActive, sortEarlier } from "@/lib/care";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";
import { ownDmAccess, ownSlackIdentity, projectCareFromDms, type OwnDmAccess } from "@/lib/care-dm";
import { careOwnerOf } from "@/lib/care-dm-rules";
import { resolveDmLinks, slackTeamId, type DmLink } from "@/lib/care-dm-link";
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
import { toEngagementCard, type EngagementCardData } from "./card";
import { ActiveList, EarlierList } from "./CareLists";
import HandoverInbox from "./HandoverInbox";
import MemberOnly from "./MemberOnly";
import { CARE_SLACK_CONNECT_HREF } from "./slack-connect";
import StartEngagementForm from "./StartEngagementForm";
import TakeoverNotices from "./TakeoverNotices";
import { CARE_TAB_LABELS, CARE_TITLE, type CareTabId } from "./tabs";

/**
 * Hedgie Care, rendered by /admin/care (Active) and /admin/care/earlier with that tab open. Both tabs' data loads here, so
 * switching is instant. The route pages call requirePermission(...) and pass the user in.
 */
export default async function CarePage({ tab, staff, memberId }: { tab: CareTabId; staff: StaffUser; /** Show only this member's care plans (`?member=`). */ memberId?: string }) {
  const now = new Date(clock.now());
  const repos = createRepos(await createClient());
  const service = getServiceRepos();
  const canWrite = staffCan(staff, "care.write");
  // Her DMs first (docs/product/HEDGIE_CARE.md): a DM is tracked because she holds a care plan with the member (a plan she holds whose
  // DM is not tracked yet is tracked now), and the tracked DMs fill in who spoke last on those plans. The list below reads the
  // result. Only her own plans and DMs are looked at; a failure is logged and the page still opens with what it has.
  if (canWrite) {
    await projectCareFromDms({ care: repos.care, careDms: repos.careDms, service }, { userId: staff.id }).catch((error) =>
      console.error("[care] filling in from tracked DMs failed:", error instanceof Error ? error.message : error)
    );
  }
  const tracked = await repos.careDms.forUser(staff.id).catch((error) => {
    console.error("[care] reading tracked DMs failed:", error instanceof Error ? error.message : error);
    return [];
  });
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
  // Whether her own Slack DMs can fill in her plans at all, worked out only when she holds an open plan whose DM is not tracked
  // (no one else needs it): a plan card says so quietly, and the Active tab carries one calm banner.
  const trackedMembers = new Set(tracked.map((dm) => dm.memberId));
  const holdsUntracked = rows.some((row) => row.closed_at === null && careOwnerOf(row) === staff.id && !trackedMembers.has(row.member_id));
  const access: OwnDmAccess | undefined = holdsUntracked
    ? await Promise.all([ownSlackIdentity(service, staff), getUserFeaturePreviews(staff.id)])
        .then(([own, previews]) => ownDmAccess(own, previews.includes("slack_dm_bridge")))
        .catch((error) => {
          console.error("[care] reading her Slack connection failed:", error instanceof Error ? error.message : error);
          return undefined;
        })
    : undefined;
  const options = {
    owners,
    byId,
    scores,
    participation,
    viewer: { userId: staff.id, isAdmin: staff.roles.includes("admin") },
    slackTracked: {
      userId: staff.id,
      memberIds: trackedMembers,
      access,
      links: new Map(tracked.flatMap((dm) => (dmLinks.has(dm.channelId) ? [[dm.memberId, dmLinks.get(dm.channelId)!] as const] : []))),
    },
  };
  const active = sortActive(
    rows.filter((row) => isActiveStatus(careStatus(row, now))),
    now
  ).map((row) => toEngagementCard(row, now, options));
  const earlier = sortEarlier(rows.filter((row) => !isActiveStatus(careStatus(row, now)))).map((row) => toEngagementCard(row, now, options));
  const attention = careAttention([...active, ...earlier]);
  // One member's care plans, when asked for (`?member=`); the counts above stay for everyone.
  const only = (cards: EngagementCardData[]) => (memberId ? cards.filter((card) => card.memberId === memberId) : cards);
  const shownMember = memberId ? [...active, ...earlier].find((card) => card.memberId === memberId)?.memberName ?? null : null;
  // What is waiting for her to accept or decline, wherever the plan is listed (Active or Earlier).
  const waiting = canWrite ? [...active, ...earlier].filter((card) => card.controls.offeredToMe) : [];
  // Plans an admin took from her without her agreement, until she dismisses the notice (wherever the plan is listed).
  const takenOver = canWrite ? [...active, ...earlier].filter((card) => card.takeoverNotice) : [];
  const needsSlack = canWrite && access === "needs_slack";

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
                  {needsSlack && (
                    <AnnouncementBar
                      tone="info"
                      action={{ label: "Connect Slack", track: "care-connect-slack-banner", href: CARE_SLACK_CONNECT_HREF, external: true }}
                      dismiss={{ dismissKey: "care-connect-slack-banner", scope: "device", track: "care-connect-slack-dismiss" }}
                    >
                      Connect Slack so your DM with each member fills in who wrote last on your care plans.
                    </AnnouncementBar>
                  )}
                  <HandoverInbox cards={waiting} />
                  <TakeoverNotices cards={takenOver} />
                  {canWrite && <StartEngagementForm today={orgYmd(now)} />}
                  <MemberOnly name={shownMember} base="/admin/care" show={!!memberId} />
                  <ActiveList cards={only(active)} canWrite={canWrite} owners={owners} meId={staff.id} />
                </div>
              ),
            },
            {
              id: "earlier",
              label: attention.lapsed > 0 ? `${CARE_TAB_LABELS.earlier} (${attention.lapsed} lapsed)` : CARE_TAB_LABELS.earlier,
              title: CARE_TAB_LABELS.earlier,
              content: (
                <>
                  <HandoverInbox cards={waiting} />
                  <TakeoverNotices cards={takenOver} />
                  <MemberOnly name={shownMember} base="/admin/care/earlier" show={!!memberId} />
                  <EarlierList cards={only(earlier)} canWrite={canWrite} owners={owners} meId={staff.id} />
                </>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
