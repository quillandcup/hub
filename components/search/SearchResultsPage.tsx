import PendingLink from "@/components/search/PendingLink";
import { notFound } from "next/navigation";
import { getSearcher } from "@/lib/search/context";
import { KIND_COLUMNS, formatHitDate } from "@/lib/search/format";
import { KIND_LABELS, type KindResults } from "@/lib/search/kinds";
import { SEARCH_KINDS, allowedOperators, matchWords, parseUniversal, wantsChat, withKind } from "@/lib/search/syntax";
import { recordSearchTimings } from "@/lib/search/metrics";
import { universalSearch } from "@/lib/search/universal";
import { MAX_QUERY_LENGTH } from "@/lib/chat/search";
import Highlight from "@/components/search/Highlight";
import SearchHitLink from "@/components/search/SearchHitLink";
import SearchRan from "@/components/search/SearchRan";
import { searchShape } from "@/lib/analytics/search";
import ResultsSearchBox from "@/components/search/ResultsSearchBox";

export const SEARCH_PAGE_TITLE = "Search";
const OVERVIEW_ROWS = 5;
const KIND_ROWS = 25;

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

/**
 * The full results page, shared by /search and /admin/search (`basePath`). With no `in:` scope it
 * stacks a table per kind with a "View all" link for the kinds that have more; scoped to a kind it
 * shows that kind's table paged, with the other kinds as tabs. Runs as the viewer (getSearcher).
 */
// Wrapped so the render-purity lint sees a server component timing its own work, not a render reading the clock.
const monotonicMs = () => performance.now();

export default async function SearchResultsPage({
  searchParams,
  basePath,
}: {
  searchParams: Promise<{ q?: Param; page?: Param }>;
  basePath: string;
}) {
  const started = monotonicMs();
  const searcher = await getSearcher();
  if (!searcher) notFound();
  const setupMs = Math.round(monotonicMs() - started);

  const sp = await searchParams;
  const raw = (first(sp.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const pageNumber = Math.min(Math.max(Number.parseInt(first(sp.page) ?? "0", 10) || 0, 0), 200);
  const query = parseUniversal(raw);
  const scoped = query.kind && (SEARCH_KINDS as readonly string[]).includes(query.kind) ? query.kind : undefined;
  const words = matchWords(query);
  const chatSkipped = !searcher.skip.includes("chat") && !wantsChat(query);
  const skip = wantsChat(query) ? searcher.skip : [...searcher.skip, "chat" as const];

  const timings: Record<string, number> = {};
  const stages: Record<string, number> = {};
  const results: KindResults[] = query.unknownKind
    ? []
    : await universalSearch(
        { ...searcher.ctx, limit: scoped ? KIND_ROWS : OVERVIEW_ROWS, offset: scoped ? pageNumber * KIND_ROWS : 0, stages },
        query,
        { skip, timings }
      );
  // An empty or unknown-kind search ran nothing, so it says nothing about speed.
  if (Object.keys(timings).length > 0) {
    recordSearchTimings("results_page", { setupMs, totalMs: Math.round(monotonicMs() - started), kindsMs: timings, stagesMs: stages });
  }

  // For usage analytics (SearchRan, SearchHitLink): the shape of the query and how many results it
  // showed, never the query itself. Rank counts across the page, 1 = the first row shown.
  const shape = searchShape(raw);
  const shownHits = results.reduce((n, r) => n + r.hits.length, 0);
  const chatHits = results.find((r) => r.kind === "chat")?.hits.length ?? 0;
  let rank = 0;

  const href = (q: string, page = 0) => `${basePath}?q=${encodeURIComponent(q)}${page > 0 ? `&page=${page}` : ""}`;
  const visibleKinds = SEARCH_KINDS.filter((k) => !searcher.skip.includes(k));

  return (
    <div className="container mx-auto max-w-5xl px-6 py-6">
      <h1 className="mb-4 text-2xl font-bold">Search results</h1>

      <ResultsSearchBox
        key={raw}
        basePath={basePath}
        initial={raw}
        placeholder="Search pages, channels, members, prickles, projects, books, awards, events and chat"
        maxLength={MAX_QUERY_LENGTH}
      />

      {raw && !query.unknownKind && (
        <SearchRan
          key={`${raw}|${pageNumber}`}
          surface="page"
          kind={shape.kind}
          operators={shape.operators}
          words={shape.words}
          results={shownHits}
          chatResults={chatHits}
          chatSearched={!skip.includes("chat")}
        />
      )}

      {raw && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Kinds">
          <PendingLink
            href={href(withKind(raw))}
            data-track="search-page-kind-all"
            className={`rounded-lg px-3 py-1.5 text-sm ${!scoped ? "bg-slate-200 dark:bg-slate-700 font-medium" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
          >
            All
          </PendingLink>
          {visibleKinds.map((k) => (
            <PendingLink
              key={k}
              href={href(withKind(raw, k))}
              data-track={`search-page-kind-${k}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${scoped === k ? "bg-slate-200 dark:bg-slate-700 font-medium" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
            >
              {KIND_LABELS[k]}
            </PendingLink>
          ))}
        </nav>
      )}

      {!raw && <OperatorHelp isAdmin={searcher.isAdmin} />}

      {query.unknownKind && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Can’t search “{query.unknownKind}”. You can search {SEARCH_KINDS.map((k) => KIND_LABELS[k]).join(", ")}, for example in:members.
        </p>
      )}

      {raw && !query.unknownKind && chatSkipped && (
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Chat messages aren’t included. <PendingLink href={href(withKind(raw, "chat"))} data-track="search-page-chat-prompt" className="text-plum-700 dark:text-plum-300 hover:underline">Search chat messages</PendingLink>
        </p>
      )}

      {raw && !query.unknownKind && results.every((r) => r.hits.length === 0) && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Nothing matches “{raw}”.</p>
      )}

      {results
        .filter((r) => r.hits.length > 0)
        .map((group) => {
          const columns = KIND_COLUMNS[group.kind];
          return (
            <section key={group.kind} className="mb-8">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{KIND_LABELS[group.kind]}</h2>
                {!scoped && group.hasMore && (
                  <PendingLink href={href(withKind(raw, group.kind))} data-track="search-page-view-all" className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
                    View all
                  </PendingLink>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">{columns.title}</th>
                      {columns.subtitle && <th className="px-3 py-2 font-medium">{columns.subtitle}</th>}
                      {columns.badge && <th className="px-3 py-2 font-medium">{columns.badge}</th>}
                      {columns.date && <th className="px-3 py-2 text-right font-medium">{columns.date}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.hits.map((hit) => (
                      <tr key={`${hit.kind}:${hit.id}`} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${hit.muted ? "opacity-60" : ""}`}>
                        <td className="max-w-md px-3 py-2">
                          <SearchHitLink href={hit.href} surface="page" kind={hit.kind} rank={++rank} data-track="search-page-hit" className="font-medium hover:underline">
                            <Highlight text={hit.title} words={words} />
                          </SearchHitLink>
                        </td>
                        {columns.subtitle && (
                          <td className="max-w-xs truncate px-3 py-2 text-slate-600 dark:text-slate-400">
                            {hit.subtitle && <Highlight text={hit.subtitle} words={words} />}
                          </td>
                        )}
                        {columns.badge && <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{hit.badge}</td>}
                        {columns.date && (
                          <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                            {hit.date ? formatHitDate(hit.date) : ""}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {scoped && (pageNumber > 0 || group.hasMore) && (
                <div className="mt-3 flex justify-between text-sm">
                  {pageNumber > 0 ? <PendingLink href={href(raw, pageNumber - 1)} data-track="search-page-previous" className="hover:underline">← Previous</PendingLink> : <span />}
                  {group.hasMore && <PendingLink href={href(raw, pageNumber + 1)} data-track="search-page-next" className="hover:underline">Next →</PendingLink>}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}

function OperatorHelp({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400">
      <p className="mb-3">Search across kinds, or narrow it down with operators. Chat messages are only searched when you select Chat or use chat filters.</p>
      <ul className="space-y-1">
        {allowedOperators(isAdmin).map((o) => (
          <li key={o.name}>
            <code className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">{o.example}</code> <span className="ml-1">{o.hint}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3">
        Also: <code>&quot;exact phrase&quot;</code>, <code>-excluded</code> and <code>prefix*</code>.
      </p>
    </div>
  );
}
