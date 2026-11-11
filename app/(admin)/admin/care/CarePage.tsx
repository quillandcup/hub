import Link from "next/link";
import { Tabs } from "@/components/Tabs";
import type { StaffUser } from "@/lib/admin-auth";
import { clock } from "@/lib/clock";
import { careStatus, isActiveStatus, sortActive, sortEarlier } from "@/lib/care";
import { loadCareOwners } from "@/lib/care-owners";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { staffCan } from "@/lib/staff-access";
import { createClient } from "@/lib/supabase/server";
import { careAttention } from "./attention";
import CareAttention from "./CareAttention";
import { toEngagementCard } from "./card";
import { ActiveList, EarlierList } from "./CareLists";
import StartEngagementForm from "./StartEngagementForm";
import { CARE_TAB_LABELS, CARE_TITLE, type CareTabId } from "./tabs";

/**
 * Hedgie Care, rendered by /admin/care (Active) and /admin/care/earlier with that tab open. Both tabs' data loads here, so
 * switching is instant. The route pages call requireStaffPage() and pass the user in.
 */
export default async function CarePage({ tab, staff }: { tab: CareTabId; staff: StaffUser }) {
  const now = new Date(clock.now());
  const repos = createRepos(await createClient());
  // Who may own one: user_profiles is read with the service role (a community manager's own client can't read other
  // users' profiles); only ids, names and roles are used.
  const [rows, owners] = await Promise.all([repos.care.list({ includeClosed: true }), loadCareOwners(repos, getServiceRepos())]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const options = { owners, byId };
  const active = sortActive(
    rows.filter((row) => isActiveStatus(careStatus(row, now))),
    now
  ).map((row) => toEngagementCard(row, now, options));
  const earlier = sortEarlier(rows.filter((row) => !isActiveStatus(careStatus(row, now)))).map((row) => toEngagementCard(row, now, options));
  const attention = careAttention([...active, ...earlier]);
  const canWrite = staffCan(staff.role, "care.write");

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="mb-2 inline-block text-plum-600 hover:underline dark:text-plum-400">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">{CARE_TITLE}</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Members you are reaching out to, one engagement for each stretch of time, and where each one stands.
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
                  {canWrite && <StartEngagementForm />}
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
          ]}
        />
      </main>
    </div>
  );
}
