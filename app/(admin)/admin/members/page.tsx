import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import MemberFilters from "./MemberFilters";
import PagedMembersTable from "./PagedMembersTable";
import type { MemberRow } from "./MembersTable";
import {
  DEFAULT_MEMBER_SORT,
  MEMBER_FILTERS,
  MEMBER_SORT_COLUMNS,
  fetchAdminMembersPage,
  type MemberFilter,
} from "@/lib/admin-members-paging";
import { parsePageParam, parsePageSizeParam, parseSortParams } from "@/lib/pagination";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Member Analytics",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPage();
  const supabase = await createClient();
  const params = await searchParams;

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const requestedFilter = (params.filter as string) || "active";
  const filter: MemberFilter = (MEMBER_FILTERS as readonly string[]).includes(requestedFilter)
    ? (requestedFilter as MemberFilter)
    : "active";
  const search = (params.search as string) || "";
  const sort = parseSortParams(params.sort, params.dir, MEMBER_SORT_COLUMNS, DEFAULT_MEMBER_SORT) ?? DEFAULT_MEMBER_SORT;

  // Server-side paging: the query itself is filtered, sorted and ranged (with
  // engagement metrics aggregated in SQL), so each view loads one page rather
  // than every member plus their entire attendance history.
  const { members, total, page, pageSize, counts: filterCounts } = await fetchAdminMembersPage(supabase, {
    filter,
    search,
    sort,
    page: parsePageParam(params.page),
    pageSize: parsePageSizeParam(params.pageSize),
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Member Analytics</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          {/* Filters */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <MemberFilters currentFilter={filter} counts={filterCounts} />
          </div>

          {/* Result count */}
          <div className="px-6 py-3 text-sm text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            {total} {total === 1 ? "member" : "members"}
            {search && (
              <>
                {" "}matching <span className="font-medium text-slate-700 dark:text-slate-300">&ldquo;{search}&rdquo;</span>
              </>
            )}
          </div>

          {/* Table */}
          <PagedMembersTable members={members as MemberRow[]} total={total} page={page} pageSize={pageSize} />

          {members.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No members found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

