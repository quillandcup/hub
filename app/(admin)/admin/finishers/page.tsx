import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdminPage } from "@/lib/admin-auth";
import { MILESTONE_STATUSES, type MilestoneStatus } from "@/lib/finishers";
import { parsePageParam } from "@/lib/pagination";
import FinishersClient from "./FinishersClient";

export const metadata: Metadata = { title: "Finishers" };

const PAGE_SIZE = 50;

/**
 * Staff view of the Finisher record (docs/FINISHERS.md): how many milestones are proposed, confirmed or declined, the
 * backfill from published books, adding one by hand, and the list. Proposals stay hidden until the member confirms.
 * ?status= narrows the list, ?page= pages it.
 */
export default async function FinishersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = (MILESTONE_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as MilestoneStatus) : undefined;
  const page = parsePageParam(params.page);

  const repos = createRepos(await createClient());
  const [counts, rows, members] = await Promise.all([
    repos.milestones.counts(),
    // One extra row says whether there is a next page.
    repos.milestones.page({ status, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    repos.members.list({ orderBy: "name" }),
  ]);

  return (
    <FinishersClient
      counts={counts}
      rows={rows.slice(0, PAGE_SIZE)}
      hasNext={rows.length > PAGE_SIZE}
      page={page}
      status={status ?? null}
      members={members.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName, status: m.status, email: m.email }))}
    />
  );
}
