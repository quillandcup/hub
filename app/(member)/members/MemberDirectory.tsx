"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import MemberAvatar from "./[id]/MemberAvatar"
import { filterDirectory, type DirectoryEntry } from "@/lib/member-directory"

/** Keep the search in the URL (?q=) so it survives reloads and "Ask me about" chips can link here. */
function syncQueryToUrl(query: string) {
  const url = new URL(window.location.href)
  if (query.trim()) url.searchParams.set("q", query)
  else url.searchParams.delete("q")
  window.history.replaceState(null, "", url)
}

export default function MemberDirectory({
  entries,
  initialQuery,
  viewerMemberId,
}: {
  entries: DirectoryEntry[]
  initialQuery: string
  viewerMemberId: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const results = useMemo(() => filterDirectory(entries, query), [entries, query])

  function search(next: string) {
    setQuery(next)
    syncQueryToUrl(next)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <label htmlFor="directory-search" className="sr-only">
          Search members
        </label>
        <input
          id="directory-search"
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search names, projects, topics, bios…"
          autoComplete="off"
          className="w-full sm:max-w-md px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
        />
        <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
          {query.trim()
            ? `${results.length} of ${entries.length} ${entries.length === 1 ? "Hedgie" : "Hedgies"}`
            : `${entries.length} ${entries.length === 1 ? "Hedgie" : "Hedgies"}`}
        </p>
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No one matches &ldquo;{query}&rdquo;.{" "}
          <button type="button" onClick={() => search("")} className="underline">
            Clear search
          </button>
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {results.map((entry) => (
            <li
              key={entry.id}
              className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex gap-3"
            >
              <MemberAvatar name={entry.displayName} photoUrl={entry.photoUrl} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/members/${entry.id}`}
                    className="font-semibold text-slate-900 dark:text-slate-100 hover:underline truncate"
                  >
                    {entry.displayName}
                  </Link>
                  {entry.id === viewerMemberId && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">(you)</span>
                  )}
                  {entry.myNote && (
                    <span
                      className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0"
                      title="You have a private note about this member"
                      aria-label="You have a private note about this member"
                    >
                      🔒 note
                    </span>
                  )}
                </div>

                {entry.projects.length > 0 && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                    <span className="text-slate-400 dark:text-slate-500">Working on </span>
                    {entry.projects.join(", ")}
                  </p>
                )}

                {entry.bio && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{entry.bio}</p>
                )}

                {entry.topics.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-xs text-slate-400 dark:text-slate-500 mr-0.5">Ask me about</span>
                    {entry.topics.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => search(topic)}
                        className="rounded-full bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 text-xs px-2 py-0.5 hover:bg-plum-100 dark:hover:bg-plum-900/50"
                        title={`Show everyone who mentions ${topic}`}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
