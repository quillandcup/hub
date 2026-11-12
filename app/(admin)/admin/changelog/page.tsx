import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { CHANGELOG_AUDIENCES, CHANGELOG_CATEGORIES } from "@/lib/changelog/entries";
import { filterByAudience, filterByCategory, groupByMonth, listChangelog, parseAudienceFilter, parseCategoryFilter, searchChangelog } from "@/lib/changelog";
import ChangelogFilters from "@/components/changelog/ChangelogFilters";

export const metadata: Metadata = { title: "Changelog" };

const majorBadge = (
  <span className="ml-2 rounded-full bg-plum-700 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-white">Major</span>
);

/**
 * Every changelog entry, product, staff and engineering (`lib/changelog/entries.ts`): what members see on What's new plus the engineering
 * history that members never do. Search, filter by category, and by audience (the filter members' page does not have).
 */
export default async function AdminChangelogPage({ searchParams }: PageProps<"/admin/changelog">) {
  await requireAdminPage();

  const params = await searchParams;
  const show = parseCategoryFilter(params.show);
  const audience = parseAudienceFilter(params.for);
  const q = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  const entries = searchChangelog(filterByCategory(filterByAudience(listChangelog(), audience), show), q);
  const months = groupByMonth(entries);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">Changelog</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">
        Everything we have shipped: what members see on{" "}
        <Link href="/changelog" className="text-plum-700 dark:text-plum-300 underline">
          What&apos;s new
        </Link>{" "}
        the tools staff use, and the engineering behind it. {entries.length} {entries.length === 1 ? "entry" : "entries"}.
      </p>

      <ChangelogFilters basePath="/admin/changelog" state={{ q, show, audience }} withAudience />

      {entries.length === 0 ? (
        <p className="mt-8 text-slate-600 dark:text-slate-400">{q ? "Nothing matches that." : "Nothing here yet."}</p>
      ) : (
        months.map((group) => (
          <section key={group.month} className="mt-8" aria-labelledby={`month-${group.month}`}>
            <h2 id={`month-${group.month}`} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {group.label}
            </h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {group.entries.map((e) => (
                <li key={e.slug}>
                  <Link href={`/admin/changelog/${e.slug}`} className="block px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                      {CHANGELOG_AUDIENCES[e.audience]} · {CHANGELOG_CATEGORIES[e.category]} · <time dateTime={e.date}>{e.date}</time>
                      {e.major && majorBadge}
                    </span>
                    <span className="mt-1 block font-semibold text-slate-900 dark:text-slate-100">{e.title}</span>
                    <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{e.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
