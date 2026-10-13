import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearcher } from "@/lib/search/context";
import { KIND_COLUMNS, formatHitDate } from "@/lib/search/format";
import { KIND_LABELS, type KindResults } from "@/lib/search/kinds";
import { SEARCH_KINDS, allowedOperators, matchWords, parseUniversal, withKind } from "@/lib/search/syntax";
import { recordSearchTimings } from "@/lib/search/metrics";
import { universalSearch } from "@/lib/search/universal";
import { MAX_QUERY_LENGTH } from "@/lib/chat/search";
import Highlight from "@/components/search/Highlight";

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
export default async function SearchResultsPage({
  searchParams,
  basePath,
}: {
  searchParams: Promise<{ q?: Param; page?: Param }>;
  basePath: string;
}) {
  const started = performance.now();
  const searcher = await getSearcher();
  if (!searcher) notFound();
  const setupMs = Math.round(performance.now() - started);

  const sp = await searchParams;
  const raw = (first(sp.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const pageNumber = Math.min(Math.max(Number.parseInt(first(sp.page) ?? "0", 10) || 0, 0), 200);
  const query = parseUniversal(raw);
  const scoped = query.kind && (SEARCH_KINDS as readonly string[]).includes(query.kind) ? query.kind : undefined;
  const words = matchWords(query);

  const timings: Record<string, number> = {};
  const results: KindResults[] = query.unknownKind
    ? []
    : await universalSearch(
        { ...searcher.ctx, limit: scoped ? KIND_ROWS : OVERVIEW_ROWS, offset: scoped ? pageNumber * KIND_ROWS : 0 },
        query,
        { skip: searcher.skip, timings }
      );
  // An empty or unknown-kind search ran nothing, so it says nothing about speed.
  if (Object.keys(timings).length > 0) {
    recordSearchTimings("results_page", { setupMs, totalMs: Math.round(performance.now() - started), kindsMs: timings });
  }

  const href = (q: string, page = 0) => `${basePath}?q=${encodeURIComponent(q)}${page > 0 ? `&page=${page}` : ""}`;
  const visibleKinds = SEARCH_KINDS.filter((k) => !searcher.skip.includes(k));

  return (
    <div className="container mx-auto max-w-5xl px-6 py-6">
      <h1 className="mb-4 text-2xl font-bold">Search results</h1>

      <form action={basePath} method="get" className="mb-4">
        <input
          name="q"
          defaultValue={raw}
          placeholder="Search channels, members, prickles, projects, books, awards, events and chat"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          aria-label="Search"
          maxLength={MAX_QUERY_LENGTH}
        />
      </form>

      {raw && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Kinds">
          <Link
            href={href(withKind(raw))}
            className={`rounded-lg px-3 py-1.5 text-sm ${!scoped ? "bg-slate-200 dark:bg-slate-700 font-medium" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
          >
            All
          </Link>
          {visibleKinds.map((k) => (
            <Link
              key={k}
              href={href(withKind(raw, k))}
              className={`rounded-lg px-3 py-1.5 text-sm ${scoped === k ? "bg-slate-200 dark:bg-slate-700 font-medium" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
            >
              {KIND_LABELS[k]}
            </Link>
          ))}
        </nav>
      )}

      {!raw && <OperatorHelp isAdmin={searcher.isAdmin} />}

      {query.unknownKind && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Can’t search “{query.unknownKind}”. You can search {SEARCH_KINDS.map((k) => KIND_LABELS[k]).join(", ")}, for example in:members.
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
                  <Link href={href(withKind(raw, group.kind))} className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
                    View all
                  </Link>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                          <Link href={hit.href} className="font-medium hover:underline">
                            <Highlight text={hit.title} words={words} />
                          </Link>
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
                  {pageNumber > 0 ? <Link href={href(raw, pageNumber - 1)} className="hover:underline">← Previous</Link> : <span />}
                  {group.hasMore && <Link href={href(raw, pageNumber + 1)} className="hover:underline">Next →</Link>}
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
      <p className="mb-3">Search everything at once, or narrow it down with operators:</p>
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
