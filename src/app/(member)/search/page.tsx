import type { Metadata } from "next";
import SearchResultsPage, { SEARCH_PAGE_TITLE } from "@/components/search/SearchResultsPage";

export const metadata: Metadata = { title: SEARCH_PAGE_TITLE };

export default function MemberSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> }) {
  return <SearchResultsPage searchParams={searchParams} basePath="/search" />;
}
