import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { requirePermission } from "@/lib/admin-auth";
import { MILESTONE_STATUSES, NOT_OPTED_IN_FILTER, type MilestoneStatus } from "@/lib/finishers";
import { fetchAllRows } from "@/lib/supabase/paginate";
import FinishersClient from "./FinishersClient";

export const metadata: Metadata = { title: "Finishers" };

/**
 * Staff view of the Finisher record (docs/product/FINISHERS.md): how many milestones are proposed, confirmed or declined, the
 * backfill from published books, adding one by hand, and the list. Proposals stay hidden until the member confirms.
 * ?status= narrows the list; sorting, search and paging happen in the shared table.
 */
export default async function FinishersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("community.manage");
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = (MILESTONE_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as MilestoneStatus) : undefined;
  const notOptedIn = params.filter === NOT_OPTED_IN_FILTER;

  const repos = createRepos(await createClient());
  const [counts, rows, members] = await Promise.all([
    repos.milestones.counts(),
    // Every row of the filter, past the 1000-row limit; the table sorts, searches and pages them.
    fetchAllRows((from, to) =>
      repos.milestones.page({ status, notOptedIn, limit: to - from + 1, offset: from }).then((data) => ({ data, error: null })),
    ),
    repos.members.list({ orderBy: "name" }),
  ]);

  return (
    <FinishersClient
      counts={counts}
      rows={rows}
      status={notOptedIn ? null : (status ?? null)}
      notOptedIn={notOptedIn}
      members={members.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName, status: m.status, email: m.email }))}
    />
  );
}
