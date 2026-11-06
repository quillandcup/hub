import Link from "next/link";
import { CHANGELOG_AUDIENCES, CHANGELOG_CATEGORIES, type ChangelogAudience, type ChangelogCategory } from "@/lib/changelog/entries";

export interface ChangelogFilterState {
  q: string;
  show: ChangelogCategory | null;
  /** The audience filter, used on the admin page only. */
  audience: ChangelogAudience | null;
}

/** The address of a filtered view: only what is set, so "no filters" is the bare path. */
export function changelogHref(basePath: string, state: Partial<ChangelogFilterState>): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.show) params.set("show", state.show);
  if (state.audience) params.set("for", state.audience);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const chip = "rounded-full px-4 py-1.5 text-sm font-medium";
const chipOn = `${chip} bg-plum-700 text-white`;
const chipOff = `${chip} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800`;

/**
 * Search and filters for a changelog page, as plain links and a GET form (the page stays a server component, a filtered view can be
 * shared). Members get a search box and New / Improved / Fixed; the admin page (`withAudience`) adds Product / Engineering / All.
 */
export default function ChangelogFilters({ basePath, state, withAudience = false }: { basePath: string; state: ChangelogFilterState; withAudience?: boolean }) {
  const categories = [{ label: "All", value: null }, ...Object.entries(CHANGELOG_CATEGORIES).map(([value, label]) => ({ label, value: value as ChangelogCategory }))];
  const audiences = [{ label: "All", value: null }, ...Object.entries(CHANGELOG_AUDIENCES).map(([value, label]) => ({ label, value: value as ChangelogAudience }))];

  return (
    <div className="mt-6 space-y-3">
      <form method="get" action={basePath} role="search" className="flex gap-2">
        {state.show && <input type="hidden" name="show" value={state.show} />}
        {withAudience && state.audience && <input type="hidden" name="for" value={state.audience} />}
        <input
          type="search"
          name="q"
          defaultValue={state.q}
          aria-label="Search updates"
          placeholder="Search updates"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
        />
        <button type="submit" data-track="changelog-search" className="rounded-lg bg-plum-700 px-4 py-2 text-sm font-medium text-white hover:bg-plum-800">
          Search
        </button>
      </form>

      {withAudience && (
        <nav aria-label="For" className="flex flex-wrap gap-2">
          {audiences.map((a) => (
            <Link
              key={a.label}
              href={changelogHref(basePath, { ...state, audience: a.value })}
              aria-current={a.value === state.audience ? "true" : undefined}
              className={a.value === state.audience ? chipOn : chipOff}
            >
              {a.label}
            </Link>
          ))}
        </nav>
      )}

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <Link
            key={c.label}
            href={changelogHref(basePath, { ...state, show: c.value })}
            data-track="changelog-filter"
            aria-current={c.value === state.show ? "true" : undefined}
            className={c.value === state.show ? chipOn : chipOff}
          >
            {c.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
