import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import SearchResultsPage, { SEARCH_PAGE_TITLE } from "@/components/search/SearchResultsPage";

export const metadata: Metadata = { title: SEARCH_PAGE_TITLE };

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> }) {
  await requireAdminPage();
  return <SearchResultsPage searchParams={searchParams} basePath="/admin/search" />;
}
